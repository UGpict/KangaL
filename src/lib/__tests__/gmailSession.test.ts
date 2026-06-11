import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearCookie,
  decryptSession,
  encryptSession,
  parseCookies,
  serializeCookie,
  sessionKeyConfigured,
  type GmailSession,
} from "@/lib/gmailSession";

// Deterministic 32-byte key (base64) so the suite does not depend on .env.local.
const TEST_KEY = Buffer.alloc(32, 7).toString("base64");
const SECRET_TOKEN = "ya29.SECRET-ACCESS-TOKEN-should-never-leak";

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.GMAIL_SESSION_KEY;
  process.env.GMAIL_SESSION_KEY = TEST_KEY;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.GMAIL_SESSION_KEY;
  else process.env.GMAIL_SESSION_KEY = savedKey;
});

describe("gmailSession crypto", () => {
  it("round-trips a session through encrypt/decrypt", () => {
    const session: GmailSession = {
      accessToken: SECRET_TOKEN,
      expiresAt: 1_900_000_000_000,
    };
    const blob = encryptSession(session);
    expect(blob).not.toBeNull();
    expect(decryptSession(blob)).toEqual(session);
  });

  it("never exposes the plaintext token inside the encrypted cookie value", () => {
    const blob = encryptSession({
      accessToken: SECRET_TOKEN,
      expiresAt: Date.now() + 3600_000,
    });
    expect(blob).not.toBeNull();
    expect(blob).not.toContain(SECRET_TOKEN);
    expect(blob).not.toContain("ya29.");
  });

  it("returns null for a tampered ciphertext (GCM auth tag fails)", () => {
    const blob = encryptSession({
      accessToken: SECRET_TOKEN,
      expiresAt: Date.now() + 3600_000,
    })!;
    const [iv, ct, tag] = blob.split(".");
    // Flip a character in the ciphertext segment.
    const flipped = ct[0] === "A" ? "B" : "A";
    const tampered = [iv, flipped + ct.slice(1), tag].join(".");
    expect(decryptSession(tampered)).toBeNull();
  });

  it("returns null for malformed or empty cookie values", () => {
    expect(decryptSession(undefined)).toBeNull();
    expect(decryptSession(null)).toBeNull();
    expect(decryptSession("")).toBeNull();
    expect(decryptSession("not-three-parts")).toBeNull();
    expect(decryptSession("a.b.c")).toBeNull();
  });

  it("treats a missing/invalid key as not configured", () => {
    delete process.env.GMAIL_SESSION_KEY;
    expect(sessionKeyConfigured()).toBe(false);
    expect(
      encryptSession({ accessToken: SECRET_TOKEN, expiresAt: 0 }),
    ).toBeNull();

    process.env.GMAIL_SESSION_KEY = Buffer.alloc(16, 1).toString("base64"); // wrong length
    expect(sessionKeyConfigured()).toBe(false);
  });

  it("cannot decrypt a blob produced under a different key", () => {
    const blob = encryptSession({
      accessToken: SECRET_TOKEN,
      expiresAt: Date.now() + 3600_000,
    })!;
    process.env.GMAIL_SESSION_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(decryptSession(blob)).toBeNull();
  });
});

describe("cookie helpers", () => {
  it("parses a Cookie header into name/value pairs", () => {
    const cookies = parseCookies("a=1; gmail_session=xyz.abc.def; b=two");
    expect(cookies.a).toBe("1");
    expect(cookies.gmail_session).toBe("xyz.abc.def");
    expect(cookies.b).toBe("two");
  });

  it("returns an empty object for a null/empty header", () => {
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });

  it("serializes a cookie with the fixed secure posture", () => {
    const str = serializeCookie("gmail_session", "v", {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });
    expect(str).toContain("gmail_session=v");
    expect(str).toContain("HttpOnly");
    expect(str).toContain("Secure");
    expect(str).toContain("SameSite=Lax");
    expect(str).toContain("Path=/");
    expect(str).toContain("Max-Age=600");
  });

  it("clearCookie expires the cookie immediately", () => {
    const str = clearCookie("gmail_session");
    expect(str).toContain("gmail_session=;");
    expect(str).toContain("Max-Age=0");
  });
});

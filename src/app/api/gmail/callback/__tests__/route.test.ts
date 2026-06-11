import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";
import { decryptSession } from "@/lib/gmailSession";

const SECRET_TOKEN = "ya29.SECRET-ACCESS-TOKEN-must-not-leak";
const STATE = "the-expected-state-value-1234567890";

const ENV_KEYS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GMAIL_SESSION_KEY",
] as const;

let saved: Record<string, string | undefined>;

function configure(): void {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "cid.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI =
    "http://localhost:3000/api/gmail/callback";
  process.env.GMAIL_SESSION_KEY = Buffer.alloc(32, 5).toString("base64");
}

function callbackRequest(params: Record<string, string>, cookie?: string) {
  const url = new URL("http://localhost:3000/api/gmail/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request(url.toString(), { headers });
}

function mockTokenSuccess(): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({ access_token: SECRET_TOKEN, expires_in: 3600 }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  configure();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("/api/gmail/callback", () => {
  it("rejects a state mismatch without exchanging a code or setting a session", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await GET(
      callbackRequest(
        { state: "attacker-supplied", code: "abc" },
        "gmail_oauth_state=" + STATE,
      ),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain(
      "gmail_error=state_mismatch",
    );
    // No token exchange should have happened on a CSRF failure.
    expect(fetchSpy).not.toHaveBeenCalled();
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("gmail_session="))).toBe(false);
  });

  it("rejects when the user denied consent", async () => {
    const res = await GET(
      callbackRequest({ error: "access_denied", state: STATE }, "gmail_oauth_state=" + STATE),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("gmail_error=access_denied");
  });

  it("redirects with exchange_failed when the token exchange fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 400 }),
    );
    const res = await GET(
      callbackRequest({ state: STATE, code: "bad" }, "gmail_oauth_state=" + STATE),
    );
    expect(res.headers.get("Location")).toContain("gmail_error=exchange_failed");
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("gmail_session="))).toBe(false);
  });

  it("on success sets an encrypted session cookie and redirects home", async () => {
    mockTokenSuccess();
    const res = await GET(
      callbackRequest({ state: STATE, code: "good" }, "gmail_oauth_state=" + STATE),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://localhost:3000/");
    const setCookies = res.headers.getSetCookie();
    const sessionCookie = setCookies.find((c) =>
      c.startsWith("gmail_session="),
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    // Decrypting the cookie value yields the original token (proves it is the
    // encrypted blob, not plaintext).
    const value = sessionCookie!.split(";")[0].split("=")[1];
    expect(decryptSession(value)?.accessToken).toBe(SECRET_TOKEN);
  });

  it("never exposes the access token in headers, body, or logs", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockTokenSuccess();

    const res = await GET(
      callbackRequest({ state: STATE, code: "good" }, "gmail_oauth_state=" + STATE),
    );

    // Location + all non-cookie headers must not contain the raw token.
    const location = res.headers.get("Location") ?? "";
    expect(location).not.toContain(SECRET_TOKEN);
    const body = await res.text();
    expect(body).not.toContain(SECRET_TOKEN);
    // The encrypted cookie must not contain the plaintext token either.
    for (const c of res.headers.getSetCookie()) {
      expect(c).not.toContain(SECRET_TOKEN);
    }
    // Nothing was logged with the token.
    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(SECRET_TOKEN);
      }
    }
  });
});

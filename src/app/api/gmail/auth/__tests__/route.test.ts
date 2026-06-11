import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../route";

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
  process.env.GMAIL_SESSION_KEY = Buffer.alloc(32, 3).toString("base64");
}

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("/api/gmail/auth", () => {
  it("redirects to Google's consent screen and sets a state cookie", async () => {
    configure();
    const res = await GET();
    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(location).toContain(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(location).toContain("access_type=online");
    const setCookie = res.headers.get("Set-Cookie")!;
    expect(setCookie).toContain("gmail_oauth_state=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("returns 503 when OAuth env vars are missing", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("gmail_not_configured");
  });

  it("returns 503 when the session key is missing even if OAuth vars are set", async () => {
    configure();
    delete process.env.GMAIL_SESSION_KEY;
    const res = await GET();
    expect(res.status).toBe(503);
  });
});

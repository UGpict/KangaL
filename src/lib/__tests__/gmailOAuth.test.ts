import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthUrl,
  exchangeCodeForToken,
  generateState,
  readOAuthConfig,
  statesMatch,
  type GmailOAuthConfig,
} from "@/lib/gmailOAuth";

const CONFIG: GmailOAuthConfig = {
  clientId: "client-id-123.apps.googleusercontent.com",
  clientSecret: "secret-xyz",
  redirectUri: "http://localhost:3000/api/gmail/callback",
};

const ENV_KEYS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("readOAuthConfig", () => {
  it("returns the config when all three vars are set", () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = CONFIG.clientId;
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = CONFIG.clientSecret;
    process.env.GOOGLE_OAUTH_REDIRECT_URI = CONFIG.redirectUri;
    expect(readOAuthConfig()).toEqual(CONFIG);
  });

  it("returns null when any var is missing", () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = CONFIG.clientId;
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = CONFIG.clientSecret;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    expect(readOAuthConfig()).toBeNull();
  });
});

describe("state", () => {
  it("generates distinct, non-trivial states", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it("matches identical states and rejects mismatches/empties", () => {
    const s = generateState();
    expect(statesMatch(s, s)).toBe(true);
    expect(statesMatch(s, generateState())).toBe(false);
    expect(statesMatch(s, undefined)).toBe(false);
    expect(statesMatch(undefined, s)).toBe(false);
    expect(statesMatch("", "")).toBe(false);
    expect(statesMatch("short", "longer-value")).toBe(false);
  });
});

describe("buildAuthUrl", () => {
  it("includes all required params and only the gmail.readonly scope", () => {
    const url = new URL(buildAuthUrl(CONFIG, "STATE123"));
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    const p = url.searchParams;
    expect(p.get("client_id")).toBe(CONFIG.clientId);
    expect(p.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.readonly",
    );
    expect(p.get("access_type")).toBe("online");
    expect(p.get("state")).toBe("STATE123");
    // No refresh-token / extra-consent params, no extra scopes.
    expect(p.get("prompt")).toBeNull();
    expect(p.get("scope")).not.toContain(" ");
  });
});

describe("exchangeCodeForToken", () => {
  it("returns the access token and computed expiry on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "ya29.TOKEN", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const before = Date.now();
    const result = await exchangeCodeForToken(CONFIG, "auth-code");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accessToken).toBe("ya29.TOKEN");
      expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3600_000);
    }
  });

  it("returns { ok: false } on a non-2xx response without leaking the body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      }),
    );
    const result = await exchangeCodeForToken(CONFIG, "bad-code");
    expect(result).toEqual({ ok: false });
  });

  it("returns { ok: false } when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    expect(await exchangeCodeForToken(CONFIG, "code")).toEqual({ ok: false });
  });

  it("returns { ok: false } when the token field is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 }),
    );
    expect(await exchangeCodeForToken(CONFIG, "code")).toEqual({ ok: false });
  });
});

// Gmail OAuth 2.0 helpers. Direct fetch against Google's endpoints — no
// googleapis dependency. Scope is locked to gmail.readonly and access_type is
// "online", so Google never issues a refresh token: the access token expires
// (~1h) and the user re-authorizes. This is a deliberate non-persistence
// choice (see implementation-notes/gmail-integration.md).

import { randomBytes, timingSafeEqual } from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function readOAuthConfig(): GmailOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function generateState(): string {
  return randomBytes(32).toString("hex");
}

// Constant-time comparison so a mismatched state cannot be probed via timing.
export function statesMatch(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function buildAuthUrl(
  config: GmailOAuthConfig,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "online",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type TokenExchangeResult =
  | { ok: true; accessToken: string; expiresAt: number }
  | { ok: false };

// Exchanges an authorization code for an access token. On any failure path the
// result is a bare { ok: false } — the response body / token is never returned
// or logged, so nothing sensitive can leak through error handling.
export async function exchangeCodeForToken(
  config: GmailOAuthConfig,
  code: string,
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return { ok: false };
  }
  if (!res.ok) return { ok: false };

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false };
  }

  const accessToken = (data as { access_token?: unknown })?.access_token;
  const expiresIn = (data as { expires_in?: unknown })?.expires_in;
  if (typeof accessToken !== "string" || typeof expiresIn !== "number") {
    return { ok: false };
  }
  return {
    ok: true,
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

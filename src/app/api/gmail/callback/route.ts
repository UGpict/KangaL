import {
  exchangeCodeForToken,
  readOAuthConfig,
  statesMatch,
} from "@/lib/gmailOAuth";
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  clearCookie,
  encryptSession,
  parseCookies,
  serializeCookie,
  sessionCookieOptions,
} from "@/lib/gmailSession";

export const runtime = "nodejs";

// Fixed, whitelisted error codes. We never reflect raw Google/query input or
// any token material into the redirect URL.
type CallbackError =
  | "not_configured"
  | "access_denied"
  | "state_mismatch"
  | "missing_code"
  | "exchange_failed"
  | "session_unavailable";

function redirectHome(origin: string): Headers {
  return new Headers({ Location: new URL("/", origin).toString() });
}

function failRedirect(origin: string, error: CallbackError): Response {
  const location = new URL("/", origin);
  location.searchParams.set("gmail_error", error);
  const headers = new Headers({ Location: location.toString() });
  // Always drop the one-time state cookie on the way out.
  headers.append("Set-Cookie", clearCookie(STATE_COOKIE));
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const config = readOAuthConfig();
  if (!config) return failRedirect(url.origin, "not_configured");
  // Post-auth redirects derive their origin from the configured OAuth redirect
  // URI (the public URL), NOT from request.url. On Cloud Run request.url
  // reflects the internal container address (e.g. http://0.0.0.0:8080), which
  // would 302 the user to an unreachable page after a successful sign-in.
  let origin: string;
  try {
    origin = new URL(config.redirectUri).origin;
  } catch {
    origin = url.origin;
  }

  // User declined consent (or Google returned an error) — no code to exchange.
  if (url.searchParams.get("error")) {
    return failRedirect(origin, "access_denied");
  }

  const cookies = parseCookies(request.headers.get("cookie"));
  const expectedState = cookies[STATE_COOKIE];
  const state = url.searchParams.get("state");
  if (!statesMatch(state, expectedState)) {
    return failRedirect(origin, "state_mismatch");
  }

  const code = url.searchParams.get("code");
  if (!code) return failRedirect(origin, "missing_code");

  const result = await exchangeCodeForToken(config, code);
  if (!result.ok) return failRedirect(origin, "exchange_failed");

  const encrypted = encryptSession({
    accessToken: result.accessToken,
    expiresAt: result.expiresAt,
  });
  if (!encrypted) return failRedirect(origin, "session_unavailable");

  const maxAge = Math.floor((result.expiresAt - Date.now()) / 1000);
  const headers = redirectHome(origin);
  headers.append(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, encrypted, sessionCookieOptions(maxAge)),
  );
  headers.append("Set-Cookie", clearCookie(STATE_COOKIE));
  return new Response(null, { status: 302, headers });
}

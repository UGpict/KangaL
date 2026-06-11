import {
  buildAuthUrl,
  generateState,
  readOAuthConfig,
} from "@/lib/gmailOAuth";
import {
  STATE_COOKIE,
  serializeCookie,
  sessionKeyConfigured,
  stateCookieOptions,
} from "@/lib/gmailSession";

export const runtime = "nodejs";

const STATE_TTL_SECONDS = 600; // the authorize round-trip is short-lived

export async function GET(): Promise<Response> {
  const config = readOAuthConfig();
  // Fail fast if Gmail is not fully configured: missing OAuth vars OR no
  // encryption key (callback could not persist the token anyway). Other
  // features keep working — this 503 is local to the Gmail flow.
  if (!config || !sessionKeyConfigured()) {
    return Response.json({ error: "gmail_not_configured" }, { status: 503 });
  }

  const state = generateState();
  const headers = new Headers({ Location: buildAuthUrl(config, state) });
  headers.append(
    "Set-Cookie",
    serializeCookie(STATE_COOKIE, state, stateCookieOptions(STATE_TTL_SECONDS)),
  );
  return new Response(null, { status: 302, headers });
}

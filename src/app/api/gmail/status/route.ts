import {
  SESSION_COOKIE,
  decryptSession,
  parseCookies,
} from "@/lib/gmailSession";

export const runtime = "nodejs";

export type GmailStatusBody =
  | { connected: false }
  | { connected: true; expiresAt: number };

// Reports whether a valid (non-expired) Gmail session cookie is present. The
// access token itself is never included in the response — only its expiry.
export async function GET(request: Request): Promise<Response> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const session = decryptSession(cookies[SESSION_COOKIE]);
  if (!session || session.expiresAt <= Date.now()) {
    return Response.json({ connected: false } satisfies GmailStatusBody);
  }
  return Response.json({
    connected: true,
    expiresAt: session.expiresAt,
  } satisfies GmailStatusBody);
}

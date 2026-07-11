// Client-IP extraction for rate limiting, tuned to the deployment topology:
// the app is served directly from a run.app URL, where the Google Front End
// APPENDS the immediate client IP as the LAST element of X-Forwarded-For.
// Everything before it arrived from the client and is forgeable — never key
// on it. If an external HTTPS Load Balancer is ever placed in front of Cloud
// Run, the trustworthy entry becomes second-from-last; revisit then.
//
// Locally (next dev) the header is absent, so all requests share the "local"
// key — which conveniently lets the per-client limit be exercised by hand.

export function getClientIp(request: Request): string {
  const header = request.headers.get("x-forwarded-for");
  if (!header) return "local";
  const tokens = header.split(",");
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i].trim();
    if (token.length > 0) return token;
  }
  return "local";
}

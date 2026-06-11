import { listInbox } from "@/lib/gmailApi";
import { readSession } from "@/lib/gmailSession";

export const runtime = "nodejs";

// Lists the most recent inbox messages as summaries (no bodies). Unauthorized
// or expired session → 401 { connected: false } so the UI (G3) can route to
// re-authorization.
export async function GET(request: Request): Promise<Response> {
  const session = readSession(request);
  if (!session) {
    return Response.json({ connected: false }, { status: 401 });
  }

  const result = await listInbox(session.accessToken);
  if (!result.ok) {
    if (result.error.kind === "unauthorized") {
      return Response.json({ connected: false }, { status: 401 });
    }
    return Response.json(
      { error: "gmail_upstream" },
      { status: result.error.status },
    );
  }
  return Response.json({ messages: result.value });
}

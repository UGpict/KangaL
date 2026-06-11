import { getMessageFull } from "@/lib/gmailApi";
import { parseMessage } from "@/lib/gmailParse";
import { readSession } from "@/lib/gmailSession";

export const runtime = "nodejs";

// Fetches one message in full and returns it shaped for /api/judge input:
// { from, subject, body, authenticationResults, truncated, authTruncated }.
// No judging happens here — G3 POSTs this to the existing /api/judge guard.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = readSession(request);
  if (!session) {
    return Response.json({ connected: false }, { status: 401 });
  }

  const { id } = await ctx.params;
  const result = await getMessageFull(session.accessToken, id);
  if (!result.ok) {
    if (result.error.kind === "unauthorized") {
      return Response.json({ connected: false }, { status: 401 });
    }
    return Response.json(
      { error: "gmail_upstream" },
      { status: result.error.status },
    );
  }

  return Response.json(parseMessage(result.value));
}

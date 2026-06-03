import { analyzeStructure } from "@/agents/analyzeStructure";
import { judge } from "@/agents/judge";

const MAX_MESSAGE_LENGTH = 8000;

export type JudgeResponseBody =
  | { degraded: true }
  | {
      degraded: false;
      score: number;
      reason: string;
      isolationNote: string | null;
    };

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const message =
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { message?: unknown }).message === "string"
      ? (payload as { message: string }).message
      : null;

  if (message === null || message.trim().length === 0) {
    return Response.json({ error: "message_required" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return Response.json({ error: "message_too_long" }, { status: 400 });
  }

  const analysis = await analyzeStructure(message);
  if (analysis.degraded) {
    return Response.json({ degraded: true } satisfies JudgeResponseBody);
  }
  const verdict = await judge(analysis.levers);
  return Response.json({
    degraded: false,
    score: verdict.score,
    reason: verdict.reason,
    isolationNote: verdict.isolationNote,
  } satisfies JudgeResponseBody);
}

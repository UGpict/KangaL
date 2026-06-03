import { analyzeStructure } from "@/agents/analyzeStructure";
import { investigate } from "@/agents/investigate";
import { judge } from "@/agents/judge";
import type {
  InvestigationBonus,
  InvestigationReport,
} from "@/types/investigation";

const MAX_MESSAGE_LENGTH = 8000;

export type JudgeResponseBody =
  | { degraded: true }
  | {
      degraded: false;
      score: number;
      reason: string;
      isolationNote: string | null;
      investigationBonus: InvestigationBonus;
      investigation: InvestigationReport;
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
  const authenticationResults =
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { authenticationResults?: unknown })
      .authenticationResults === "string"
      ? (payload as { authenticationResults: string }).authenticationResults
      : undefined;

  if (message === null || message.trim().length === 0) {
    return Response.json({ error: "message_required" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return Response.json({ error: "message_too_long" }, { status: 400 });
  }

  const analysis = await analyzeStructure(message);
  if (analysis.degraded) {
    // 判定保留 — neither investigate nor judge runs. Lever values from a
    // degraded analysis are placeholders (see analyzeStructure NEUTRAL_LEVERS).
    return Response.json({ degraded: true } satisfies JudgeResponseBody);
  }

  const investigation = await investigate({
    message,
    levers: analysis.levers,
    authenticationResults,
  });
  const verdict = await judge(analysis.levers, investigation);

  return Response.json({
    degraded: false,
    score: verdict.score,
    reason: verdict.reason,
    isolationNote: verdict.isolationNote,
    investigationBonus: verdict.investigationBonus,
    investigation,
  } satisfies JudgeResponseBody);
}

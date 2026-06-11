import { analyzeStructure } from "@/agents/analyzeStructure";
import { investigate } from "@/agents/investigate";
import { judge } from "@/agents/judge";
import { readBoundedJson } from "@/lib/readBoundedJson";
import { MAX_AUTH_LENGTH, MAX_MESSAGE_LENGTH } from "@/lib/inputLimits";
import type {
  InvestigationBonus,
  InvestigationReport,
} from "@/types/investigation";

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
  const parsed = await readBoundedJson(request);
  if (!parsed.ok) {
    const status = parsed.error === "payload_too_large" ? 413 : 400;
    return Response.json({ error: parsed.error }, { status });
  }
  const payload = parsed.value;

  const message =
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { message?: unknown }).message === "string"
      ? (payload as { message: string }).message
      : null;
  const authRaw =
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
  if (authRaw !== undefined && authRaw.length > MAX_AUTH_LENGTH) {
    return Response.json(
      { error: "authentication_results_too_long" },
      { status: 400 },
    );
  }
  // 空白のみは未指定として正規化。verifySenderAuth が内部で trim するため、
  // この正規化は判定ロジックに影響しない（"" と undefined は下流で同値）。
  const trimmedAuth = authRaw?.trim();
  const authenticationResults =
    trimmedAuth && trimmedAuth.length > 0 ? trimmedAuth : undefined;

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

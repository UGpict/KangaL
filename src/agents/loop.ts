import {
  generateAttackPattern,
  evolve,
  type DetectionFeedback,
  type GenerateAttackPatternInput,
} from "@/agents/attacker";
import { analyzeStructure } from "@/agents/analyzeStructure";
import { investigate, type InvestigateInput } from "@/agents/investigate";
import { judge } from "@/agents/judge";
import { assertDemoMode } from "@/lib/demoMode";
import { upsertAttackPattern } from "@/lib/firestore";
import {
  getDetectionThreshold,
  recordRound,
  type Judged,
  type RoundMetrics,
} from "@/lib/metrics";
import type { AlertFetcher } from "@/tools/reconPublicAlerts";
import type { AttackPattern, Sample } from "@/types/attackPattern";
import type { InvestigationReport } from "@/types/investigation";

// ── Why a hand-rolled loop and not a framework ──────────────────────────
// The 攻防 大枠 (生成 → 調査 → 判定 → 進化) is a deterministic sequential
// workflow; the only *dynamic* decision — which investigation tools to call —
// already lives in Task 6's function-calling router (investigate.ts), which we
// must NOT reach into ("ADK から直接触らない", §6-4). The rest of the repo
// hand-rolls orchestration directly on @google/genai, so introducing an
// orchestration framework here for a for-loop would be inconsistent and buy
// nothing. The "ADK" adoption is therefore deferred; this file keeps the
// ADK-shaped structure — agents as injectable units behind a fixed workflow —
// so a later swap stays mechanical.

const DEFAULT_MAX_ROUNDS = 5;

// Loop-centric agent surface. Each agent is keyed off the AttackPattern (the
// loop's unit of work), so the defender's message/levers plumbing stays an
// implementation detail of the default adapters below. Tests inject mocks for
// any subset; unspecified agents fall back to the real implementations.
export type LoopAgents = {
  generateAttackPattern: (
    input: GenerateAttackPatternInput,
  ) => Promise<AttackPattern>;
  investigate: (pattern: AttackPattern) => Promise<InvestigationReport>;
  judge: (
    pattern: AttackPattern,
    report: InvestigationReport,
  ) => Promise<{ score: number }>;
  evolve: (prev: AttackPattern, feedback: DetectionFeedback) => AttackPattern;
  // 最小閉ループ (PLAN-v2 T2/V2): すり抜けた (detected=false) 型を attackPatterns
  // コーパスへ永続化する。これにより次ラウンド以降、anchor の matchKnownScams が
  // 類似パターンを捕捉できる＝検知器がラウンド間で育つ。デフォルトは実 Firestore
  // writer（upsertAttackPattern）。テストはモックを注入する。
  persistPattern: (pattern: AttackPattern) => Promise<void>;
  // Scores a ground-truth metrics sample (benign baseline, or extra scams) for
  // a given round. Re-scored every round so FPR/recall can move as the defender
  // improves (investigate reads the growing attackPatterns corpus — closed loop,
  // T2/V2). Default runs the sample's messageBody through the same paste pipeline
  // (analyzeStructure→investigate→judge) the /api/judge route uses, so sample
  // scores share the loop's 0-100 scale and detection threshold (T3).
  judgeSample: (sample: Sample, round: number) => Promise<{ score: number }>;
};

export type AgentOverrides = Partial<LoopAgents>;

// T3: real sample judging. A ground-truth Sample carries only a messageBody
// (道B: never a lever-encoded attack), so unlike the loop's pattern path (which
// already holds levers), a sample must first be structurally analyzed. This is
// exactly the paste path of /api/judge (route.ts): analyzeStructure → investigate
// → judge. The returned score is on the same 0-100 scale recall/fpr threshold
// against getDetectionThreshold() — no second threshold is defined here.
// A degraded structure analysis (Gemini failure) yields score 0 = 判定保留 ⇒
// not detected, matching the route's degraded branch. `round` is unused but kept
// in the agent signature: re-scoring each round is meaningful because investigate
// reads the growing attackPatterns corpus (closed loop, T2/V2).
// 柱2 二段運用の注入点: investigation 層だけを live/キャッシュで差し替えられる
// ようにする唯一の seam。analyzeStructure（防御の知覚）と judge は固定のまま。
// - live（既定）: deps を省略 → 実 investigate（Web Risk/RDAP 等の関数呼び出し）。
//   実運用の実力値レポート用。
// - cached: 凍結済み InvestigationReport を返す関数を渡す。BEFORE/AFTER 差分主張と
//   本番デモ用。investigate を固定することで、run 間の非決定を analyzeStructure
//   由来だけに絞れる（4分類 attribution の missed-perception が純粋に知覚失敗を指す）。
// キャッシュ関数は levers を無視し sample（message）でキーするのが想定（知覚が
// run ごとにブレても同じ凍結 report を返す）。
export type InvestigateFn = (
  input: InvestigateInput,
) => Promise<InvestigationReport>;

export async function judgeSampleViaPipeline(
  sample: Sample,
  deps: { investigate?: InvestigateFn } = {},
): Promise<{ score: number }> {
  const investigateFn = deps.investigate ?? investigate;
  const analysis = await analyzeStructure(sample.messageBody);
  if (analysis.degraded) return { score: 0 };
  const investigation = await investigateFn({
    message: sample.messageBody,
    levers: analysis.levers,
  });
  const { score } = await judge(analysis.levers, investigation);
  return { score };
}

const DEFAULT_AGENTS: LoopAgents = {
  generateAttackPattern,
  investigate: (pattern) => investigate({ message: "", levers: pattern.levers }),
  judge: (pattern, report) => judge(pattern.levers, report),
  evolve,
  persistPattern: upsertAttackPattern,
  judgeSample: (sample) => judgeSampleViaPipeline(sample),
};

export type LoopOptions = {
  // 5〜10 in normal operation; callers pass their own (the hard-limit path
  // accepts smaller values too). Defaults to 5.
  maxRounds?: number;
  agents?: AgentOverrides;
  reconFetcher?: AlertFetcher;
  // Ground-truth set for per-round recall/FPR. The current attack pattern is
  // ALWAYS counted as a scam on top of these; benign entries here are what give
  // FPR meaning. Empty → metrics derive from the pattern alone (fpr === null).
  samples?: Sample[];
};

export type RoundRecord = {
  round: number;
  pattern: AttackPattern;
  report: InvestigationReport;
  result: { detected: boolean; score: number };
  metrics: RoundMetrics;
};

export type LoopResult = {
  rounds: RoundRecord[];
  finalDetected: boolean;
  totalRounds: number;
};

export async function runLoop(options: LoopOptions = {}): Promise<LoopResult> {
  // モード分離（Task 8-D）: 攻撃エージェントを含むループはデモ/研究モード限定。
  // DEMO_MODE 無効時はここで例外を投げ、一切実行しない。
  assertDemoMode();

  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const threshold = getDetectionThreshold();
  const agents: LoopAgents = { ...DEFAULT_AGENTS, ...options.agents };
  const samples = options.samples ?? [];

  const rounds: RoundRecord[] = [];
  let finalDetected = false;

  let pattern = await agents.generateAttackPattern({
    reconFetcher: options.reconFetcher,
  });

  for (let round = 1; round <= maxRounds; round++) {
    const report = await agents.investigate(pattern);
    const { score } = await agents.judge(pattern, report);
    const detected = score >= threshold;
    // 生産→消費の引き継ぎ: defender(investigate) が埋めた missedBy（ToolName[]）を
    // そのまま detectionResult に持ち込む。算出はしない（配線のみ）。
    pattern.detectionResult = { detected, missedBy: report.missedBy };

    // Round metrics: the evolving型 as the round's scam, plus the benign
    // baseline (and any extra scams) so FPR is real, not a divide-by-zero null.
    const judged: Judged[] = [{ kind: "scam", score }];
    for (const sample of samples) {
      const { score: sampleScore } = await agents.judgeSample(sample, round);
      judged.push({ kind: sample.kind, score: sampleScore });
    }
    const metrics = recordRound(judged, threshold);

    rounds.push({
      round,
      pattern,
      report,
      result: { detected, score },
      metrics,
    });

    if (detected) {
      finalDetected = true;
      break;
    }

    // すり抜け → 最小閉ループ (PLAN-v2 T2/V2): この型を attackPatterns コーパスへ
    // 書き戻し、次ラウンド以降の anchor(matchKnownScams) が類似を捕捉できるようにする。
    // 最終ラウンド（evolve しない）でもコーパスには残すため、evolve ガードの外で行う。
    // V3: この永続化は defender 側の loop が行い、attacker.ts は firestore に依存しない。
    await agents.persistPattern(pattern);

    // 次ラウンドが実際に子を消費するときだけ進化させる（ハード制限の
    // 最終ラウンドで捨てる型は変異しない）。
    // missedBy 配線（Task 8-B）: defender が複数ツールの死角を返しても、消費側
    // evolve は単一語彙（DetectionFeedback.missedBy: string）なので先頭1件だけを
    // 橋渡しする。missedBy 無しなら undefined → evolve は固定ラダー経路を通る。
    if (round < maxRounds) {
      const firstMissed = pattern.detectionResult.missedBy?.[0];
      pattern = agents.evolve(pattern, { detected: false, missedBy: firstMissed });
    }
  }

  return { rounds, finalDetected, totalRounds: rounds.length };
}

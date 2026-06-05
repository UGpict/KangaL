import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { runLoop, type AgentOverrides } from "@/agents/loop";
import type { AttackPattern, Sample } from "@/types/attackPattern";
import type { InvestigationReport } from "@/types/investigation";

// Task 8-D: runLoop はモード分離ガード（assertDemoMode）配下。これらのテストは
// ループ本体の挙動を検証するものなので、DEMO_MODE=true を立ててから実行し、後で復元する。
let savedDemoMode: string | undefined;
beforeAll(() => {
  savedDemoMode = process.env.DEMO_MODE;
  process.env.DEMO_MODE = "true";
});
afterAll(() => {
  if (savedDemoMode === undefined) {
    delete process.env.DEMO_MODE;
  } else {
    process.env.DEMO_MODE = savedDemoMode;
  }
});

// Default detection threshold is 70 (DEFAULT_DETECTION_THRESHOLD). Mock judge
// scores are chosen unambiguously around it: <70 = slipped, ≥70 = caught.

function basePattern(): AttackPattern {
  return {
    id: "gen1",
    generation: 1,
    sourceContext: "test",
    channel: "email",
    levers: {
      urgency: { tactic: "deadline", intensity: 1 },
      authority: { impersonates: "financial", credibilityTricks: ["formal_tone"] },
      incentive: { type: "fear", hook: "account_loss", intensity: 1 },
      callToAction: { action: "click_link", friction: "mid" },
      personalization: { level: "broadcast", signals: [] },
      isolation: { tactic: "none", intensity: 0 },
    },
  };
}

function stubReport(): InvestigationReport {
  return {
    truncated: false,
    truncatedReason: null,
    bonus: { items: [], total: 0, capped: false },
  };
}

// Builds a mocked agent set whose judge returns `scores[round-1]` for the
// attack pattern, in order. evolve is a spy that increments generation so each
// round gets a distinct pattern. judgeSample (benign baseline scoring) is
// optional and defaults to a neutral 0.
function makeAgents(
  scores: number[],
  judgeSample?: AgentOverrides["judgeSample"],
): {
  agents: AgentOverrides;
  evolveSpy: ReturnType<typeof vi.fn>;
  persistSpy: ReturnType<typeof vi.fn>;
} {
  let judgeCalls = 0;
  const evolveSpy = vi.fn((prev: AttackPattern) => {
    const next = structuredClone(prev);
    next.id = `gen${prev.generation + 1}`;
    next.parentId = prev.id;
    next.generation = prev.generation + 1;
    delete next.detectionResult;
    return next;
  });
  // 書き戻しは実 Firestore を叩かせない（テストはモックを注入する）。
  const persistSpy = vi.fn(async () => {});
  const agents: AgentOverrides = {
    generateAttackPattern: async () => basePattern(),
    investigate: async () => stubReport(),
    judge: async () => ({ score: scores[judgeCalls++] }),
    evolve: evolveSpy,
    persistPattern: persistSpy,
    ...(judgeSample ? { judgeSample } : {}),
  };
  return { agents, evolveSpy, persistSpy };
}

describe("runLoop", () => {
  it("すり抜け→学習→回復: 3ラウンドで検知に至り、recall が [低,低,高]", async () => {
    const { agents } = makeAgents([50, 60, 90]); // detected: false, false, true

    const result = await runLoop({ maxRounds: 5, agents });

    expect(result.rounds.length).toBe(3);
    expect(result.totalRounds).toBe(3);
    expect(result.finalDetected).toBe(true);
    expect(result.rounds.map((r) => r.result.detected)).toEqual([
      false,
      false,
      true,
    ]);

    // Every round recorded a metrics snapshot.
    for (const r of result.rounds) {
      expect(r.metrics).toBeDefined();
      expect(r.metrics.recall).not.toBeNull();
    }

    // recall ギザギザ: dips low while the型 slips, recovers once caught.
    const recallTrend = result.rounds.map((r) => r.metrics.recall);
    expect(recallTrend).toEqual([0, 0, 1]);
    expect(recallTrend[0]!).toBeLessThan(recallTrend[2]!);
  });

  it("maxRounds ハード制限: 全ラウンドすり抜けても maxRounds で強制終了", async () => {
    const { agents } = makeAgents([50, 50, 50, 50, 50]);

    const result = await runLoop({ maxRounds: 3, agents });

    expect(result.rounds.length).toBe(3);
    expect(result.totalRounds).toBe(3);
    expect(result.finalDetected).toBe(false);
    expect(result.rounds.every((r) => r.result.detected === false)).toBe(true);
  });

  it("FPR 低位安定: recall が上昇しても全ラウンドで fpr <= 0.1", async () => {
    // 10 benign baseline samples; exactly one is (wrongly) flagged → fpr 0.1.
    const benigns: Sample[] = Array.from({ length: 10 }, (_, i) => ({
      kind: "benign" as const,
      messageBody: `benign-${i}`,
    }));
    const judgeSample: AgentOverrides["judgeSample"] = async (sample) => ({
      score: sample.messageBody === "benign-0" ? 75 : 10,
    });
    const { agents } = makeAgents([50, 90], judgeSample); // recall 0 → 1

    const result = await runLoop({
      maxRounds: 5,
      agents,
      samples: benigns,
    });

    expect(result.finalDetected).toBe(true);
    // recall rose across the run...
    const recall = result.rounds.map((r) => r.metrics.recall);
    expect(recall).toEqual([0, 1]);
    // ...while FPR stayed pinned low every round.
    for (const r of result.rounds) {
      expect(r.metrics.fpr).not.toBeNull();
      expect(r.metrics.fpr!).toBeLessThanOrEqual(0.1);
    }
  });

  it("evolve 契約: 検知ラウンドでは呼ばれず、すり抜けラウンドでのみ呼ばれる", async () => {
    // [false, true]: evolve fires once (after round 1), never on the caught round.
    const slipThenCatch = makeAgents([50, 90]);
    const r1 = await runLoop({ maxRounds: 5, agents: slipThenCatch.agents });

    expect(r1.rounds.map((r) => r.result.detected)).toEqual([false, true]);
    expect(slipThenCatch.evolveSpy).toHaveBeenCalledTimes(1);
    // Task 7 contract: evolve is only ever handed detected=false feedback.
    expect(slipThenCatch.evolveSpy).toHaveBeenCalledWith(
      expect.anything(),
      { detected: false },
    );

    // First round already caught → evolve must never fire.
    const caughtImmediately = makeAgents([90]);
    const r2 = await runLoop({ maxRounds: 5, agents: caughtImmediately.agents });

    expect(r2.finalDetected).toBe(true);
    expect(r2.rounds.length).toBe(1);
    expect(caughtImmediately.evolveSpy).not.toHaveBeenCalled();
  });

  it("missedBy 配線: defender の missedBy 先頭1件が evolve に渡る (Task 8-B)", async () => {
    // investigate が複数ツールの死角を返しても、loop は先頭1件だけを単一文字列の
    // DetectionFeedback.missedBy に橋渡しする（消費側 evolve は単一語彙のため）。
    const { agents, evolveSpy } = makeAgents([50, 90]); // すり抜け→検知
    agents.investigate = async () => ({
      ...stubReport(),
      missedBy: ["urlReputation", "senderAuth"],
    });

    const result = await runLoop({ maxRounds: 5, agents });

    expect(result.rounds.map((r) => r.result.detected)).toEqual([false, true]);
    // 先頭の "urlReputation" のみが渡る（配列 → 単一の橋渡し）。
    expect(evolveSpy).toHaveBeenCalledTimes(1);
    expect(evolveSpy).toHaveBeenCalledWith(expect.anything(), {
      detected: false,
      missedBy: "urlReputation",
    });
    // detectionResult.missedBy には配列全体が引き継がれている。
    expect(result.rounds[0]!.pattern.detectionResult?.missedBy).toEqual([
      "urlReputation",
      "senderAuth",
    ]);
  });

  it("閉ループ: すり抜けたラウンドのみ書き戻し、検知ラウンドでは書き戻さない (T2/V2)", async () => {
    // [50,50,90]: round1,2 すり抜け→書き戻し、round3 検知→書き戻さない。
    const { agents, persistSpy } = makeAgents([50, 50, 90]);
    const result = await runLoop({ maxRounds: 5, agents });

    expect(result.rounds.map((r) => r.result.detected)).toEqual([
      false,
      false,
      true,
    ]);
    // すり抜け2回だけ persist。検知ラウンドは入れない（既に捕捉できる型）。
    expect(persistSpy).toHaveBeenCalledTimes(2);
    // 各 persist 引数はそのラウンドの（すり抜けた）型。
    expect(persistSpy.mock.calls[0]![0].generation).toBe(1);
    expect(persistSpy.mock.calls[1]![0].generation).toBe(2);
  });

  it("閉ループ: 最終ラウンドのすり抜けもコーパスへ書き戻す (evolve しない回も)", async () => {
    // 全すり抜け・maxRounds=3 → 3ラウンドとも書き戻す（最終ラウンド含む）。
    const { agents, persistSpy } = makeAgents([50, 50, 50]);
    const result = await runLoop({ maxRounds: 3, agents });

    expect(result.finalDetected).toBe(false);
    expect(persistSpy).toHaveBeenCalledTimes(3);
  });

  it("閉ループ: 初手検知なら一度も書き戻さない", async () => {
    const { agents, persistSpy } = makeAgents([90]);
    await runLoop({ maxRounds: 5, agents });
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it("missedBy 無し: feedback は { detected: false } のまま（先頭取り出しが undefined）", async () => {
    // stubReport には missedBy が無い → firstMissed=undefined → 固定ラダー経路。
    const { agents, evolveSpy } = makeAgents([50, 90]);
    await runLoop({ maxRounds: 5, agents });
    expect(evolveSpy).toHaveBeenCalledWith(expect.anything(), {
      detected: false,
    });
  });

  // 型レベル担保: missedBy は ToolName[] のみ。ToolName 以外は tsc で弾かれる
  // （@ts-expect-error が出なければ＝型が緩ければコンパイル失敗する）。
  it("型レベル: ToolName 以外は missedBy に入らない", () => {
    const ok: InvestigationReport["missedBy"] = ["urlReputation", "senderAuth"];
    // @ts-expect-error "notATool" は ToolName ではない
    const bad: InvestigationReport["missedBy"] = ["notATool"];
    expect(ok).toBeDefined();
    void bad;
  });
});

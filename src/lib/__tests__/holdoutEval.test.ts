import { describe, expect, it } from "vitest";
import {
  ciCrosses,
  ciOverlap,
  classifyAttribution,
  compareHoldout,
  floorSweepBands,
  isPerceivedAttack,
  majorityFlagged,
  sampleDetectionRate,
  SMALL_SAMPLE_N,
  summarizeHoldout,
  wilsonInterval,
  type SampleSignals,
  type ScoreRow,
} from "../holdoutEval";
import type { AttackPattern } from "@/types/attackPattern";

type Levers = AttackPattern["levers"];

const THRESHOLD = 70; // 凍結: 既定 detection threshold。env 非依存にするため明示渡し。

const BENIGN_LEVERS: Levers = {
  urgency: { tactic: "none", intensity: 0 },
  authority: { impersonates: "none", credibilityTricks: [] },
  incentive: { type: "reward", hook: "prize", intensity: 0 },
  callToAction: { action: "click_link", friction: "high" },
  personalization: { level: "broadcast", signals: [] },
  isolation: { tactic: "none", intensity: 0 },
};

function levers(overrides: Partial<Levers>): Levers {
  return { ...structuredClone(BENIGN_LEVERS), ...overrides };
}

function signal(over: Partial<SampleSignals>): SampleSignals {
  return {
    id: "s",
    kind: "scam",
    degraded: false,
    perceivedLevers: structuredClone(BENIGN_LEVERS),
    score: 0,
    leverScore: 0,
    knownScamBonusRaw: 0,
    otherInvestigationBonusRaw: 0,
    ...over,
  };
}

describe("isPerceivedAttack（構造述語・凍結）", () => {
  it("素の良性レバー（none/broadcast/click_link）は攻撃骨格と見なさない", () => {
    expect(isPerceivedAttack(BENIGN_LEVERS)).toBe(false);
  });

  it("能動的な強レバーが一つでも立てば true", () => {
    expect(isPerceivedAttack(levers({ isolation: { tactic: "secrecy", intensity: 1 } }))).toBe(true);
    expect(isPerceivedAttack(levers({ urgency: { tactic: "deadline", intensity: 2 } }))).toBe(true);
    expect(isPerceivedAttack(levers({ authority: { impersonates: "executive", credibilityTricks: [] } }))).toBe(true);
    expect(isPerceivedAttack(levers({ callToAction: { action: "transfer_money", friction: "low" } }))).toBe(true);
    expect(isPerceivedAttack(levers({ callToAction: { action: "input_credentials", friction: "low" } }))).toBe(true);
    expect(isPerceivedAttack(levers({ personalization: { level: "targeted", signals: [] } }))).toBe(true);
    expect(isPerceivedAttack(levers({ personalization: { level: "broadcast", signals: ["real_name"] } }))).toBe(true);
  });

  it("弱い urgency(=1) 単独では攻撃骨格と見なさない（良性の軽い催促を拾わない）", () => {
    expect(isPerceivedAttack(levers({ urgency: { tactic: "deadline", intensity: 1 } }))).toBe(false);
  });
});

describe("classifyAttribution（4分類・凍結）", () => {
  it("degraded が最優先（score/知覚に関わらず）", () => {
    expect(classifyAttribution(signal({ degraded: true, score: 99 }), THRESHOLD)).toBe("degraded");
  });

  it("score ≥ threshold は detected", () => {
    expect(classifyAttribution(signal({ score: 70 }), THRESHOLD)).toBe("detected");
    expect(classifyAttribution(signal({ score: 85 }), THRESHOLD)).toBe("detected");
  });

  it("床下＋攻撃骨格を知覚 → missed-floored（床ゲート）", () => {
    const s = signal({
      score: 55,
      perceivedLevers: levers({ isolation: { tactic: "secrecy", intensity: 1 } }),
    });
    expect(classifyAttribution(s, THRESHOLD)).toBe("missed-floored");
  });

  it("床下＋骨格を知覚できず → missed-perception", () => {
    const s = signal({ score: 20, perceivedLevers: structuredClone(BENIGN_LEVERS) });
    expect(classifyAttribution(s, THRESHOLD)).toBe("missed-perception");
  });

  it("perceivedLevers が null（degraded でない異常）でも床下なら missed-perception", () => {
    expect(classifyAttribution(signal({ score: 10, perceivedLevers: null }), THRESHOLD)).toBe("missed-perception");
  });
});

describe("summarizeHoldout: recall 生カウント＋4分類", () => {
  it("scam を 4 分類で数え、detected を生カウントで返す", () => {
    const signals: SampleSignals[] = [
      signal({ id: "a", score: 80 }), // detected
      signal({ id: "b", score: 72, leverScore: 72 }), // detected
      signal({ id: "c", score: 55, perceivedLevers: levers({ isolation: { tactic: "secrecy", intensity: 2 } }) }), // floored
      signal({ id: "d", score: 15 }), // perception
      signal({ id: "e", degraded: true, perceivedLevers: null }), // degraded
    ];
    const sum = summarizeHoldout(signals, { threshold: THRESHOLD });
    expect(sum.scamTotal).toBe(5);
    expect(sum.detected).toBe(2);
    expect(sum.byClass).toEqual({
      detected: 2,
      "missed-floored": 1,
      "missed-perception": 1,
      degraded: 1,
    });
  });

  it("smallSample は scam 数が SMALL_SAMPLE_N 未満で true", () => {
    const few = summarizeHoldout([signal({ score: 80 })], { threshold: THRESHOLD });
    expect(few.smallSample).toBe(true);
    const many = summarizeHoldout(
      Array.from({ length: SMALL_SAMPLE_N }, (_, i) => signal({ id: `s${i}`, score: 80 })),
      { threshold: THRESHOLD },
    );
    expect(many.smallSample).toBe(false);
  });
});

describe("summarizeHoldout: detection drivers（counterfactual 切り分け）", () => {
  it("leverAlone: レバー素点だけで閾値到達", () => {
    const sum = summarizeHoldout([signal({ score: 75, leverScore: 75 })], { threshold: THRESHOLD });
    expect(sum.drivers.leverAlone).toBe(1);
    expect(sum.drivers.dependsOnKnownScam).toBe(0);
    expect(sum.drivers.dependsOnInvestigation).toBe(0);
  });

  it("dependsOnKnownScam: known-scam bonus を外すと床下＝corpus 依存", () => {
    // leverScore 60 + known 15 = 75 detected。known を外すと 60 < 70。
    const sum = summarizeHoldout(
      [signal({ score: 75, leverScore: 60, knownScamBonusRaw: 15 })],
      { threshold: THRESHOLD },
    );
    expect(sum.drivers.dependsOnKnownScam).toBe(1);
    expect(sum.drivers.dependsOnInvestigation).toBe(0);
    expect(sum.drivers.leverAlone).toBe(0);
  });

  it("dependsOnInvestigation: 外部調査 bonus を外すと床下＝調査依存", () => {
    const sum = summarizeHoldout(
      [signal({ score: 75, leverScore: 60, otherInvestigationBonusRaw: 15 })],
      { threshold: THRESHOLD },
    );
    expect(sum.drivers.dependsOnInvestigation).toBe(1);
    expect(sum.drivers.dependsOnKnownScam).toBe(0);
  });

  it("両方依存: 単独では不足、合算(cap 25)で到達 → 両カウンタに入る（排他でない）", () => {
    // leverScore 50 + min(25, 15+15)=25 → 75 detected。
    // known を外すと 50+15=65<70、investigation を外すと 50+15=65<70。
    const sum = summarizeHoldout(
      [signal({ score: 75, leverScore: 50, knownScamBonusRaw: 15, otherInvestigationBonusRaw: 15 })],
      { threshold: THRESHOLD },
    );
    expect(sum.drivers.dependsOnKnownScam).toBe(1);
    expect(sum.drivers.dependsOnInvestigation).toBe(1);
  });
});

describe("summarizeHoldout: FPR は帯別（pool 禁止）", () => {
  it("benign を benignDifficulty で割り、帯ごとに falseFlagged/benignTotal を生カウント", () => {
    // easy 3件中1件 FP / effective 2件中1件 FP。pool すれば 2/5 だが、それは出さない。
    const signals: SampleSignals[] = [
      signal({ id: "e1", kind: "benign", benignDifficulty: "easy", score: 10 }),
      signal({ id: "e2", kind: "benign", benignDifficulty: "easy", score: 72 }), // FP
      signal({ id: "e3", kind: "benign", benignDifficulty: "easy", score: 30 }),
      signal({ id: "f1", kind: "benign", benignDifficulty: "effective", score: 80 }), // FP
      signal({ id: "f2", kind: "benign", benignDifficulty: "effective", score: 40 }),
    ];
    const sum = summarizeHoldout(signals, { threshold: THRESHOLD });

    expect(sum.benignTotal).toBe(5);
    // pooled な falseFlagged フィールドは存在しない（主報告で pool しない）。
    expect(sum).not.toHaveProperty("falseFlagged");
    expect(sum).not.toHaveProperty("fprIsLowerBound");

    expect(sum.fprByDifficulty.easy).toEqual({
      benignTotal: 3,
      falseFlagged: 1,
      fprIsLowerBound: true, // easy＝楽観・下界
    });
    expect(sum.fprByDifficulty.effective).toEqual({
      benignTotal: 2,
      falseFlagged: 1,
      fprIsLowerBound: false, // effective＝保守側
    });
  });

  it("benignDifficulty 未指定の benign は easy 帯に寄せる（最も楽観側）", () => {
    const sum = summarizeHoldout(
      [signal({ id: "b", kind: "benign", score: 72 })],
      { threshold: THRESHOLD },
    );
    expect(sum.fprByDifficulty.easy).toEqual({
      benignTotal: 1,
      falseFlagged: 1,
      fprIsLowerBound: true,
    });
    expect(sum.fprByDifficulty.effective).toBeUndefined();
  });
});

describe("wilsonInterval（95% score interval・凍結）", () => {
  it("n=0 は全 0（破綻させない）", () => {
    expect(wilsonInterval(0, 0)).toEqual({ p: 0, lo: 0, hi: 0 });
  });

  it("点推定 p=x/n、区間は [0,1] にクランプ", () => {
    const ci = wilsonInterval(0, 6); // 0/6
    expect(ci.p).toBe(0);
    expect(ci.lo).toBe(0); // クランプで負にならない
    expect(ci.hi).toBeGreaterThan(0);
    expect(ci.hi).toBeCloseTo(0.39, 1); // 0/6 の Wilson 上限 ≈ 0.39
  });

  it("3/6=0.5 の区間は 0.5 を中心にまたぐ（小標本＝広い）", () => {
    const ci = wilsonInterval(3, 6);
    expect(ci.p).toBe(0.5);
    expect(ci.lo).toBeLessThan(0.5);
    expect(ci.hi).toBeGreaterThan(0.5);
  });

  it("n を増やすと同じ p でも区間が狭まる", () => {
    const small = wilsonInterval(5, 10);
    const big = wilsonInterval(50, 100);
    expect(big.hi - big.lo).toBeLessThan(small.hi - small.lo);
  });
});

describe("ciCrosses / ciOverlap（区間述語）", () => {
  it("ciCrosses: 既定 0.5 をまたぐか", () => {
    expect(ciCrosses({ p: 0.5, lo: 0.2, hi: 0.8 })).toBe(true);
    expect(ciCrosses({ p: 0.9, lo: 0.6, hi: 1 })).toBe(false); // 0.5 より上で外す
    expect(ciCrosses({ p: 0.1, lo: 0, hi: 0.4 })).toBe(false); // 0.5 より下で外す
  });

  it("ciCrosses: 値指定（床境界など）", () => {
    expect(ciCrosses({ p: 0.7, lo: 0.5, hi: 0.9 }, 0.6)).toBe(true);
  });

  it("ciOverlap: 重なる/分離を判定", () => {
    expect(ciOverlap({ p: 0.5, lo: 0.2, hi: 0.8 }, { p: 0.6, lo: 0.4, hi: 0.9 })).toBe(true);
    expect(ciOverlap({ p: 0.1, lo: 0, hi: 0.3 }, { p: 0.9, lo: 0.7, hi: 1 })).toBe(false);
  });
});

describe("majorityFlagged（多数決検出・正本）", () => {
  it("hit/K ≥ 0.5 で true（ちょうど 0.5 は検出側）", () => {
    expect(majorityFlagged([70, 70, 50, 50], 60)).toBe(true); // 2/4=0.5
    expect(majorityFlagged([70, 50, 50, 50], 60)).toBe(false); // 1/4
  });
  it("空配列は false", () => {
    expect(majorityFlagged([], 60)).toBe(false);
  });
});

describe("sampleDetectionRate（per-sample 検出率＋床際コインフリップ）", () => {
  it("0/K 張り付き＝床下、CI は 0.5 をまたがない（knifeEdge=false）", () => {
    const d = sampleDetectionRate("apple", [41, 45, 55, 41, 45, 61, 35, 45, 55, 45], 70);
    expect(d.hit).toBe(0);
    expect(d.n).toBe(10);
    expect(d.knifeEdge).toBe(false);
  });

  it("中間（~0.5）＝床際コインフリップ（knifeEdge=true）", () => {
    // etax-scam@床60: scores 全件 ≥60 か僅差 → floor を上げて中間を作る。
    const d = sampleDetectionRate("x", [65, 61, 61, 61, 65, 65, 65, 65, 49, 61], 62);
    // ≥62: 65×5 = 5/10 → 0.5、CI は広く 0.5 をまたぐ。
    expect(d.hit).toBe(5);
    expect(d.knifeEdge).toBe(true);
  });
});

describe("floorSweepBands（床×{recall,FPR帯別} をバンドで）", () => {
  const rows: ScoreRow[] = [
    { id: "sc1", kind: "scam", scores: [80, 80, 80, 80, 80] }, // 全床で検出
    { id: "sc2", kind: "scam", scores: [50, 50, 50, 50, 50] }, // 床60で未検出, 床55も未
    { id: "be1", kind: "benign", benignDifficulty: "easy", scores: [10, 10, 10, 10, 10] },
  ];

  it("scam/easy/effective を分けて X/n＋CI を出す", () => {
    const bands = floorSweepBands(rows, [60, 55]);
    const f60 = bands.find((b) => b.floor === 60)!;
    expect(f60.recall.x).toBe(1); // sc1 のみ
    expect(f60.recall.n).toBe(2);
    expect(f60.recall.ci.p).toBe(0.5);
    expect(f60.fprEasy).toEqual(expect.objectContaining({ x: 0, n: 1 }));
    expect(f60.fprEffective).toBeNull(); // effective 0件＝測定不能
  });

  it("effective 帯があれば別 CI で出す（pool しない）", () => {
    const withEff: ScoreRow[] = [
      ...rows,
      { id: "ef1", kind: "benign", benignDifficulty: "effective", scores: [80, 80, 80, 80, 80] },
    ];
    const bands = floorSweepBands(withEff, [60]);
    expect(bands[0].fprEffective).toEqual(expect.objectContaining({ x: 1, n: 1 }));
    expect(bands[0].fprEasy).toEqual(expect.objectContaining({ x: 0, n: 1 }));
  });
});

describe("compareHoldout: BEFORE→AFTER 差分", () => {
  it("detected の生カウント差を返す", () => {
    const before = summarizeHoldout([signal({ score: 20 }), signal({ score: 30 })], { threshold: THRESHOLD });
    const after = summarizeHoldout([signal({ score: 80 }), signal({ score: 30 })], { threshold: THRESHOLD });
    const delta = compareHoldout(before, after);
    expect(before.detected).toBe(0);
    expect(after.detected).toBe(1);
    expect(delta.detectedDelta).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  classifyAttribution,
  compareHoldout,
  isPerceivedAttack,
  SMALL_SAMPLE_N,
  summarizeHoldout,
  type SampleSignals,
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
    const sum = summarizeHoldout(signals, { threshold: THRESHOLD, benignDifficulty: "mixed" });
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
    const few = summarizeHoldout([signal({ score: 80 })], { threshold: THRESHOLD, benignDifficulty: "mixed" });
    expect(few.smallSample).toBe(true);
    const many = summarizeHoldout(
      Array.from({ length: SMALL_SAMPLE_N }, (_, i) => signal({ id: `s${i}`, score: 80 })),
      { threshold: THRESHOLD, benignDifficulty: "mixed" },
    );
    expect(many.smallSample).toBe(false);
  });
});

describe("summarizeHoldout: detection drivers（counterfactual 切り分け）", () => {
  it("leverAlone: レバー素点だけで閾値到達", () => {
    const sum = summarizeHoldout([signal({ score: 75, leverScore: 75 })], { threshold: THRESHOLD, benignDifficulty: "mixed" });
    expect(sum.drivers.leverAlone).toBe(1);
    expect(sum.drivers.dependsOnKnownScam).toBe(0);
    expect(sum.drivers.dependsOnInvestigation).toBe(0);
  });

  it("dependsOnKnownScam: known-scam bonus を外すと床下＝corpus 依存", () => {
    // leverScore 60 + known 15 = 75 detected。known を外すと 60 < 70。
    const sum = summarizeHoldout(
      [signal({ score: 75, leverScore: 60, knownScamBonusRaw: 15 })],
      { threshold: THRESHOLD, benignDifficulty: "mixed" },
    );
    expect(sum.drivers.dependsOnKnownScam).toBe(1);
    expect(sum.drivers.dependsOnInvestigation).toBe(0);
    expect(sum.drivers.leverAlone).toBe(0);
  });

  it("dependsOnInvestigation: 外部調査 bonus を外すと床下＝調査依存", () => {
    const sum = summarizeHoldout(
      [signal({ score: 75, leverScore: 60, otherInvestigationBonusRaw: 15 })],
      { threshold: THRESHOLD, benignDifficulty: "mixed" },
    );
    expect(sum.drivers.dependsOnInvestigation).toBe(1);
    expect(sum.drivers.dependsOnKnownScam).toBe(0);
  });

  it("両方依存: 単独では不足、合算(cap 25)で到達 → 両カウンタに入る（排他でない）", () => {
    // leverScore 50 + min(25, 15+15)=25 → 75 detected。
    // known を外すと 50+15=65<70、investigation を外すと 50+15=65<70。
    const sum = summarizeHoldout(
      [signal({ score: 75, leverScore: 50, knownScamBonusRaw: 15, otherInvestigationBonusRaw: 15 })],
      { threshold: THRESHOLD, benignDifficulty: "mixed" },
    );
    expect(sum.drivers.dependsOnKnownScam).toBe(1);
    expect(sum.drivers.dependsOnInvestigation).toBe(1);
  });
});

describe("summarizeHoldout: FPR 生カウント＋下界フラグ", () => {
  it("benign の誤検出を生カウントし、easy-only は下界フラグ立て", () => {
    const signals: SampleSignals[] = [
      signal({ id: "b1", kind: "benign", score: 10 }),
      signal({ id: "b2", kind: "benign", score: 72 }), // 誤検出
      signal({ id: "b3", kind: "benign", score: 30 }),
    ];
    const easy = summarizeHoldout(signals, { threshold: THRESHOLD, benignDifficulty: "easy" });
    expect(easy.benignTotal).toBe(3);
    expect(easy.falseFlagged).toBe(1);
    expect(easy.fprIsLowerBound).toBe(true);

    const mixed = summarizeHoldout(signals, { threshold: THRESHOLD, benignDifficulty: "mixed" });
    expect(mixed.fprIsLowerBound).toBe(false);
  });
});

describe("compareHoldout: BEFORE→AFTER 差分", () => {
  it("detected の生カウント差を返す", () => {
    const before = summarizeHoldout([signal({ score: 20 }), signal({ score: 30 })], { threshold: THRESHOLD, benignDifficulty: "mixed" });
    const after = summarizeHoldout([signal({ score: 80 }), signal({ score: 30 })], { threshold: THRESHOLD, benignDifficulty: "mixed" });
    const delta = compareHoldout(before, after);
    expect(before.detected).toBe(0);
    expect(after.detected).toBe(1);
    expect(delta.detectedDelta).toBe(1);
  });
});

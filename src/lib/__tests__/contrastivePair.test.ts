import { describe, expect, it } from "vitest";
import type { AttackPattern } from "@/types/attackPattern";
import { exampleAttackPattern } from "@/types/__fixtures__/attackPattern.example";
import {
  changedLevers,
  leverFingerprint,
  majorityVote,
  validateContrastivePair,
  type Draw,
} from "@/lib/contrastivePair";

type Levers = AttackPattern["levers"];
const BASE = exampleAttackPattern.levers;

// A benign-shaped base: 正規なのに軽くレバーが立つ（authority=executive の至急依頼だが
// isolation は none）。mutation は isolation を1個足すだけ、を想定。
const BENIGN_BASE: Levers = {
  urgency: { tactic: "deadline", intensity: 2 },
  authority: { impersonates: "executive", credibilityTricks: ["formal_tone"] },
  incentive: { type: "fear", hook: "penalty", intensity: 1 },
  callToAction: { action: "transfer_money", friction: "low" },
  personalization: { level: "targeted", signals: ["real_name"] },
  isolation: { tactic: "none", intensity: 0 },
};
// isolation だけ足した mutated（target = isolation）。
const MUTATED_ISO: Levers = {
  ...BENIGN_BASE,
  isolation: { tactic: "secrecy", intensity: 3 },
};

function draws(levers: Levers, n: number): Draw[] {
  return Array.from({ length: n }, () => ({ levers, degraded: false }));
}

describe("contrastivePair — fingerprint & changedLevers", () => {
  it("fingerprint captures score-relevant fields; intensity-only drift counts as changed", () => {
    const hotter: Levers = { ...BENIGN_BASE, urgency: { tactic: "deadline", intensity: 3 } };
    expect(leverFingerprint("urgency", BENIGN_BASE)).not.toBe(
      leverFingerprint("urgency", hotter),
    );
    expect(changedLevers(BENIGN_BASE, hotter)).toEqual(["urgency"]);
  });

  it("credibilityTricks / signals order does not matter (sorted)", () => {
    const a: Levers = {
      ...BASE,
      authority: { impersonates: "executive", credibilityTricks: ["formal_tone", "reference_number"] },
    };
    const b: Levers = {
      ...BASE,
      authority: { impersonates: "executive", credibilityTricks: ["reference_number", "formal_tone"] },
    };
    expect(changedLevers(a, b)).toEqual([]);
  });
});

describe("contrastivePair — majorityVote", () => {
  it("picks the per-lever mode and flags fragile (knife-edge) modes", () => {
    // isolation: 3× none + 2× secrecy → mode none, ratio 3/5 = 0.6 → fragile.
    const mixed: Draw[] = [
      ...draws(BENIGN_BASE, 3),
      ...draws(MUTATED_ISO, 2),
    ];
    const r = majorityVote(mixed);
    expect(r.validN).toBe(5);
    const iso = r.votes.find((v) => v.key === "isolation")!;
    expect(iso.modeFp).toBe(leverFingerprint("isolation", BENIGN_BASE));
    expect(iso.fragile).toBe(true);
    // a lever that never varied is not fragile.
    expect(r.votes.find((v) => v.key === "callToAction")!.fragile).toBe(false);
  });

  it("excludes degraded draws from the vote", () => {
    const d: Draw[] = [
      ...draws(BENIGN_BASE, 4),
      { levers: BENIGN_BASE, degraded: true },
    ];
    const r = majorityVote(d);
    expect(r.validN).toBe(4);
    expect(r.degradedN).toBe(1);
  });

  it("returns null modeLevers when every draw is degraded", () => {
    const r = majorityVote([{ levers: BENIGN_BASE, degraded: true }]);
    expect(r.modeLevers).toBeNull();
    expect(r.validN).toBe(0);
  });
});

describe("contrastivePair — validateContrastivePair", () => {
  it("accepts a clean pair that moves exactly the target lever", () => {
    const r = validateContrastivePair({
      baseDraws: draws(BENIGN_BASE, 5),
      mutatedDraws: draws(MUTATED_ISO, 5),
      targetLever: "isolation",
    });
    expect(r.valid).toBe(true);
    expect(r.moved).toEqual(["isolation"]);
    expect(r.fragile).toEqual([]);
    expect(r.reason).toBe("valid");
  });

  it("rejects contamination when an extra lever drifts", () => {
    // mutation moved isolation AND (unintended) urgency intensity.
    const contaminated: Levers = {
      ...MUTATED_ISO,
      urgency: { tactic: "deadline", intensity: 3 },
    };
    const r = validateContrastivePair({
      baseDraws: draws(BENIGN_BASE, 5),
      mutatedDraws: draws(contaminated, 5),
      targetLever: "isolation",
    });
    expect(r.valid).toBe(false);
    expect(r.moved.sort()).toEqual(["isolation", "urgency"]);
    expect(r.reason).toContain("contamination");
  });

  it("rejects when the target lever did not move", () => {
    // only urgency moved; isolation (the target) stayed none.
    const wrong: Levers = { ...BENIGN_BASE, urgency: { tactic: "deadline", intensity: 3 } };
    const r = validateContrastivePair({
      baseDraws: draws(BENIGN_BASE, 5),
      mutatedDraws: draws(wrong, 5),
      targetLever: "isolation",
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("target_not_moved");
  });

  it("rejects when nothing moved (mutation had no structural effect)", () => {
    const r = validateContrastivePair({
      baseDraws: draws(BENIGN_BASE, 5),
      mutatedDraws: draws(BENIGN_BASE, 5),
      targetLever: "isolation",
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("no_lever_moved");
  });

  it("marks a valid pair fragile when a mode is knife-edge", () => {
    // base isolation mode is 3/5 none (fragile), mutated is 5/5 secrecy.
    const r = validateContrastivePair({
      baseDraws: [...draws(BENIGN_BASE, 3), ...draws(MUTATED_ISO, 2)],
      mutatedDraws: draws(MUTATED_ISO, 5),
      targetLever: "isolation",
    });
    expect(r.valid).toBe(true);
    expect(r.fragile).toContain("isolation");
    expect(r.reason).toContain("valid_but_fragile");
  });

  it("holds when there are too few valid draws", () => {
    const r = validateContrastivePair({
      baseDraws: draws(BENIGN_BASE, 2),
      mutatedDraws: draws(MUTATED_ISO, 5),
      targetLever: "isolation",
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("insufficient_valid_draws");
  });
});

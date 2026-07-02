import { describe, expect, it } from "vitest";
import type { AttackPattern } from "@/types/attackPattern";
import { exampleAttackPattern } from "@/types/__fixtures__/attackPattern.example";
import { encodeLevers, leverSimilarity } from "@/lib/leverVector";

type Levers = AttackPattern["levers"];
const BASE = exampleAttackPattern.levers;

// A fully-absent pattern: every block encodes to zeros (callToAction
// click_link/high has strength 0 too). Mirrors analyzeStructure's NEUTRAL_LEVERS.
const NEUTRAL: Levers = {
  urgency: { tactic: "none", intensity: 0 },
  authority: { impersonates: "none", credibilityTricks: [] },
  incentive: { type: "reward", hook: "prize", intensity: 0 },
  callToAction: { action: "click_link", friction: "high" },
  personalization: { level: "broadcast", signals: [] },
  isolation: { tactic: "none", intensity: 0 },
};

describe("leverVector — encoding + weighted cosine", () => {
  it("self-similarity is exactly 1 and every pair is in [0,1]", () => {
    expect(leverSimilarity(BASE, BASE)).toBeCloseTo(1, 12);
    for (const other of [NEUTRAL, { ...BASE, isolation: { tactic: "none", intensity: 0 } as Levers["isolation"] }]) {
      const s = leverSimilarity(BASE, other);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("the incentive reward↔fear coin-flip is invisible (decision B)", () => {
    // Same pattern, only incentive.type flipped ⇒ identical encoding ⇒ sim 1.
    const flipped: Levers = {
      ...BASE,
      incentive: { ...BASE.incentive, type: BASE.incentive.type === "fear" ? "reward" : "fear" },
    };
    expect(encodeLevers(flipped)).toEqual(encodeLevers(BASE));
    expect(leverSimilarity(BASE, flipped)).toBeCloseTo(1, 12);
  });

  it("absence contributes 0 — turning an active lever off lowers similarity, and absence is intensity-independent", () => {
    const noIso0: Levers = { ...BASE, isolation: { tactic: "none", intensity: 0 } };
    const noIso3: Levers = { ...BASE, isolation: { tactic: "none", intensity: 3 } };
    // Dropping isolation (a heavy active lever) strictly lowers similarity.
    expect(leverSimilarity(BASE, noIso0)).toBeLessThan(1);
    // "none" is absence regardless of intensity ⇒ both encode isolation to zero ⇒
    // identical vectors ⇒ identical similarity to BASE.
    expect(encodeLevers(noIso0)).toEqual(encodeLevers(noIso3));
    expect(leverSimilarity(BASE, noIso0)).toBe(leverSimilarity(BASE, noIso3));
  });

  it("LEVER_WEIGHTS dominate: a pair matching only on isolation scores higher than one matching only on urgency", () => {
    // Each pair shares exactly one heavy/light lever (same strength=3) and
    // differs only on authority (executive vs financial, equal weight/strength,
    // non-overlapping slots). Everything else is absence/zero. Isolation weight
    // (5) > urgency weight (2) ⇒ the shared isolation block dominates the cosine.
    const isoA: Levers = { ...NEUTRAL, authority: { impersonates: "executive", credibilityTricks: [] }, isolation: { tactic: "secrecy", intensity: 3 } };
    const isoB: Levers = { ...NEUTRAL, authority: { impersonates: "financial", credibilityTricks: [] }, isolation: { tactic: "secrecy", intensity: 3 } };
    const urgA: Levers = { ...NEUTRAL, authority: { impersonates: "executive", credibilityTricks: [] }, urgency: { tactic: "deadline", intensity: 3 } };
    const urgB: Levers = { ...NEUTRAL, authority: { impersonates: "financial", credibilityTricks: [] }, urgency: { tactic: "deadline", intensity: 3 } };
    expect(leverSimilarity(isoA, isoB)).toBeGreaterThan(leverSimilarity(urgA, urgB));
  });

  it("strength is monotonic: higher shared intensity ⇒ higher similarity to the query", () => {
    const q = BASE; // isolation secrecy intensity 3
    const weak: Levers = { ...BASE, isolation: { tactic: "secrecy", intensity: 1 } };
    const mid: Levers = { ...BASE, isolation: { tactic: "secrecy", intensity: 2 } };
    const sExact = leverSimilarity(q, BASE);
    const sMid = leverSimilarity(q, mid);
    const sWeak = leverSimilarity(q, weak);
    expect(sExact).toBeCloseTo(1, 12);
    expect(sExact).toBeGreaterThan(sMid);
    expect(sMid).toBeGreaterThan(sWeak);
  });

  it("zero-vector guard: an all-absence pattern matches nothing (including itself)", () => {
    expect(encodeLevers(NEUTRAL).every((x) => x === 0)).toBe(true);
    expect(leverSimilarity(NEUTRAL, BASE)).toBe(0);
    expect(leverSimilarity(NEUTRAL, NEUTRAL)).toBe(0);
  });
});

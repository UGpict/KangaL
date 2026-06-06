import type { AttackPattern } from "@/types/attackPattern";
import {
  BONUS_KNOWN_SCAM_CAP,
  BONUS_KNOWN_SCAM_PER_MATCH,
  type LeverKey,
} from "@/lib/weights";
import { LEVER_KEYS, classifyMatchedLever, mainValue } from "@/lib/levers";
import { KNOWN_SCAM_HIT_THRESHOLD } from "@/tools/matchKnownScams";

// ── EVALUATION-SIDE interpretation of holdout flips. ──────────────────────
// mainValue / classifyMatchedLever / LEVER_KEYS now live in the neutral
// @/lib/levers module (shared with the detector). This module imports them and
// builds the *counterfactual* used to stricten the (a)/(b) self-check: "would
// this holdout still flip on ACTIVE levers alone?". It still never reaches into
// the detector except to read the hit threshold constant.

// Lever keys whose main-value is equal between two patterns (mirrors the
// detector's similarity numerator).
export function matchedLeverKeys(
  a: AttackPattern["levers"],
  b: AttackPattern["levers"],
): LeverKey[] {
  return LEVER_KEYS.filter((k) => mainValue(k, a) === mainValue(k, b));
}

// The (a) subset of matchedLeverKeys (coin-flip / absence matches removed).
export function activeMatchedLeverKeys(
  a: AttackPattern["levers"],
  b: AttackPattern["levers"],
): LeverKey[] {
  return matchedLeverKeys(a, b).filter(
    (k) => classifyMatchedLever(k, mainValue(k, a)) === "active",
  );
}

function meetsThreshold(matched: number): boolean {
  return matched / LEVER_KEYS.length >= KNOWN_SCAM_HIT_THRESHOLD;
}

// Corpus docs whose FULL main-enum overlap clears the hit threshold (identical
// rule to matchKnownScams — used only for offline reconstruction in tests).
export function countFullMatches(
  holdout: AttackPattern["levers"],
  corpus: AttackPattern[],
): number {
  return corpus.filter((p) => meetsThreshold(matchedLeverKeys(holdout, p.levers).length))
    .length;
}

// Corpus docs that clear the hit threshold using ACTIVE levers alone. This is
// the counterfactual: strip every (b) artifact lever from the similarity and
// see what still matches.
export function countActiveMatches(
  holdout: AttackPattern["levers"],
  corpus: AttackPattern[],
): number {
  return corpus.filter((p) =>
    meetsThreshold(activeMatchedLeverKeys(holdout, p.levers).length),
  ).length;
}

export function knownScamBonus(matchCount: number): number {
  return Math.min(BONUS_KNOWN_SCAM_CAP, matchCount * BONUS_KNOWN_SCAM_PER_MATCH);
}

// True if the flip has *any* active basis: some full-match corpus doc shares at
// least one active lever. Distinguishes a coin-flip-dependent flip (active
// signal present but not load-bearing alone) from a pure-artifact flip.
export function hasAnyActiveMatch(
  holdout: AttackPattern["levers"],
  corpus: AttackPattern[],
): boolean {
  return corpus.some(
    (p) =>
      meetsThreshold(matchedLeverKeys(holdout, p.levers).length) &&
      activeMatchedLeverKeys(holdout, p.levers).length > 0,
  );
}

export type FlipTier = "robust" | "coinflip_dependent" | "non_generalization";

// Three-tier strictening of the (a)/(b) self-check. Replaces the old
// "matchedActive.length > 0 ⇒ 汎化" rule, which over-counted flips that only
// reached 3/6 because a coin-flip (incentive.type) or absence match was
// load-bearing.
//  - robust:             flipped, AND active levers alone still clear the
//                        detection threshold (the flip survives stripping every
//                        artifact) ⇒ genuine generalization.
//  - coinflip_dependent: flipped with ≥1 active match, but active levers alone
//                        do NOT clear the threshold — an artifact was
//                        load-bearing for crossing 3/6. NOT counted as
//                        generalization.
//  - non_generalization: did not flip, OR flipped with zero active match.
export function classifyFlipTier(args: {
  flipped: boolean;
  activeOnlyDetected: boolean;
  hasActiveMatch: boolean;
}): FlipTier {
  if (!args.flipped) return "non_generalization";
  if (args.activeOnlyDetected) return "robust";
  if (args.hasActiveMatch) return "coinflip_dependent";
  return "non_generalization";
}

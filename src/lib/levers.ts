import type { AttackPattern } from "@/types/attackPattern";
import { LEVER_WEIGHTS, type LeverKey } from "@/lib/weights";

// ── Neutral lever-vocabulary module. ──────────────────────────────────────
// Shared, dependency-light source of truth for "the dominant enum value of a
// lever" and "is a matched lever an attacker's deliberate choice or a cheap
// artifact?". Both the DETECTOR (matchKnownScams) and the EVALUATION side
// (generalizationCheck) import from here. This module imports only weights +
// types — never the detector or the evaluator — so the dependency arrows are
// detector→levers and evaluator→levers, never detector→evaluator.

// Single source of truth for lever count — never hardcode /6. Adding a 7th
// lever propagates automatically through the similarity computation and the
// evaluation-side counterfactual.
export const LEVER_KEYS = Object.keys(LEVER_WEIGHTS) as LeverKey[];

// The dominant enum value of each lever. For MVP the detector uses this single
// value per lever — fast, deterministic, good enough to demonstrate routing.
// FUTURE: vector-search similarity once the corpus is large enough that
// enum-only overlap misses semantically-equivalent attacks.
export function mainValue(
  key: LeverKey,
  levers: AttackPattern["levers"],
): string {
  switch (key) {
    case "urgency":
      return levers.urgency.tactic;
    case "authority":
      return levers.authority.impersonates;
    case "incentive":
      return levers.incentive.type;
    case "callToAction":
      return levers.callToAction.action;
    case "personalization":
      return levers.personalization.level;
    case "isolation":
      return levers.isolation.tactic;
  }
}

// (a) active = an attacker's deliberate lever choice; a match here is a
// meaningful generalization signal. (b) artifact = a structurally cheap match:
//  - incentive.type is a reward/fear coin-flip (~50% to match by chance);
//  - urgency/isolation "none", personalization "broadcast", authority "none"
//    are *absence* — matching on absence is not evidence the detector
//    recognized an attack structure.
export function classifyMatchedLever(
  key: LeverKey,
  value: string,
): "active" | "artifact" {
  switch (key) {
    case "incentive":
      return "artifact";
    case "urgency":
      return value === "none" ? "artifact" : "active";
    case "isolation":
      return value === "none" ? "artifact" : "active";
    case "personalization":
      return value === "broadcast" ? "artifact" : "active";
    case "authority":
      return value === "none" ? "artifact" : "active";
    case "callToAction":
      return "active";
  }
}

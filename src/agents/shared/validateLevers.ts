import type { AttackPattern } from "@/types/attackPattern";
import {
  CREDIBILITY_TRICKS,
  CTA_ACTIONS,
  FRICTIONS,
  IMPERSONATES,
  INCENTIVE_HOOKS,
  INCENTIVE_TYPES,
  ISOLATION_TACTICS,
  PERSONALIZATION_LEVELS,
  PERSONALIZATION_SIGNALS,
  URGENCY_TACTICS,
} from "@/agents/shared/leversSchema";

// Deep runtime validator for the 6-lever shape, shared by analyzeStructure
// (defense) and attacker (attack). This is the second wall behind Gemini's
// responseSchema: the API enforces enum/required strongly but INTEGER
// minimum/maximum only weakly, and a shallow guard would let a malformed
// intensity flow into strengthOf as NaN — where `NaN >= threshold` is false
// and the message silently lands in the SAFE band (fail-open).
//
// Deliberately strict beyond type-shape:
// - Unknown keys are REJECTED, at the top level and inside each lever. An
//   unexpected key is exactly the vector for smuggling free text through a
//   lever payload (道B), and Gemini under responseSchema has no legitimate
//   reason to emit one — the false-degradation cost is ~zero.
// - Duplicate array entries are REJECTED: duplicated credibilityTricks would
//   silently inflate authority strength (Math.min(3, 1 + length) in
//   weights.strengthOf), and evolve already treats these arrays as sets.

type FieldPredicate = (value: unknown) => boolean;

const enumOf =
  (allowed: readonly string[]): FieldPredicate =>
  (value) =>
    typeof value === "string" && allowed.includes(value);

// typeof check first: Number.isInteger alone accepts only numbers too, but
// does not narrow for the range comparison below.
const intensity: FieldPredicate = (value) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 3;

const arrayOf =
  (allowed: readonly string[]): FieldPredicate =>
  (value) =>
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && allowed.includes(item)) &&
    new Set(value).size === value.length;

// One entry per lever; the walker enforces exact key equality against this
// table, so unknown-key rejection falls out of the spec for free.
const LEVER_SPEC: Record<
  keyof AttackPattern["levers"],
  Record<string, FieldPredicate>
> = {
  urgency: { tactic: enumOf(URGENCY_TACTICS), intensity },
  authority: {
    impersonates: enumOf(IMPERSONATES),
    credibilityTricks: arrayOf(CREDIBILITY_TRICKS),
  },
  incentive: {
    type: enumOf(INCENTIVE_TYPES),
    hook: enumOf(INCENTIVE_HOOKS),
    intensity,
  },
  callToAction: { action: enumOf(CTA_ACTIONS), friction: enumOf(FRICTIONS) },
  personalization: {
    level: enumOf(PERSONALIZATION_LEVELS),
    signals: arrayOf(PERSONALIZATION_SIGNALS),
  },
  isolation: { tactic: enumOf(ISOLATION_TACTICS), intensity },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  obj: Record<string, unknown>,
  expected: string[],
): boolean {
  const keys = Object.keys(obj);
  return (
    keys.length === expected.length && expected.every((k) => k in obj)
  );
}

export function isLeversShape(
  value: unknown,
): value is AttackPattern["levers"] {
  if (!isPlainObject(value)) return false;
  const leverKeys = Object.keys(LEVER_SPEC);
  if (!hasExactKeys(value, leverKeys)) return false;

  for (const leverKey of leverKeys) {
    const lever = value[leverKey];
    if (!isPlainObject(lever)) return false;
    const spec = LEVER_SPEC[leverKey as keyof AttackPattern["levers"]];
    const fieldKeys = Object.keys(spec);
    if (!hasExactKeys(lever, fieldKeys)) return false;
    for (const fieldKey of fieldKeys) {
      if (!spec[fieldKey](lever[fieldKey])) return false;
    }
  }
  return true;
}

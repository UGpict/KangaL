import type { AttackPattern } from "@/types/attackPattern";
import { LEVER_WEIGHTS, strengthOf } from "@/lib/weights";

// ── Dense lever-vector encoding + weighted-cosine similarity. ──────────────
//
// The A-anchor upgrade of matchKnownScams: replace discrete "count of active
// matched main-enum levers / 6" with a continuous nearest-neighbor measure that
// still honors every principle of the discrete rule, but credits *partial*
// proximity (near-misses the 3/6 cutoff dropped).
//
// Encoding: each lever → a strength-scaled one-hot block. The active enum value
// gets `strength/3 ∈ [0,1]` (reusing weights.strengthOf — the SAME strength
// model judge.computeScore uses), and the whole block is scaled by
// `sqrt(LEVER_WEIGHTS[key])` so a full isolation match (w=5) outweighs a full
// urgency match (w=2) in the dot product. All features are ≥ 0, so cosine of two
// encodings is in [0,1] BY CONSTRUCTION (no clamping).
//
// Why this reproduces the discrete rule's principles:
//  - Absence → zero block. urgency/isolation "none", authority "none",
//    personalization "broadcast" map to the null slot ⇒ zero sub-vector ⇒ zero
//    dot contribution. Mirrors classifyMatchedLever's "absence is not evidence".
//  - Coin-flip invisible (design decision B). incentive is a SINGLE magnitude
//    axis = intensity/3, shared by reward and fear, so swapping incentive.type
//    leaves the vector unchanged. A stronger form of "the reward/fear coin-flip
//    is never credited" than the old numerator exclusion.
//  - Weight-driven. `sqrt(LEVER_WEIGHTS)` reuses the detector's own weights as
//    feature weights — principled and independent of any holdout.
//
// Lives in @/lib (neutral module) so the arrows stay detector→leverVector and
// evaluator→leverVector, never detector→evaluator.

type Levers = AttackPattern["levers"];

// Active enum values per lever (absence values are intentionally omitted — they
// resolve to the null slot = a zero block). Personalization "broadcast" and the
// urgency/authority/isolation "none" values are absences by classifyMatchedLever.
export const URGENCY_SLOTS = [
  "deadline",
  "account_freeze",
  "limited_offer",
] as const;
export const AUTHORITY_SLOTS = [
  "financial",
  "government",
  "business_partner",
  "executive",
  "delivery",
  "platform",
] as const;
export const CTA_SLOTS = [
  "click_link",
  "transfer_money",
  "input_credentials",
  "call_number",
  "install_app",
  "scan_qr",
] as const;
export const PERSONALIZATION_SLOTS = ["segmented", "targeted"] as const; // "broadcast" → zero block
export const ISOLATION_SLOTS = [
  "secrecy",
  "bypass_approval",
  "direct_channel",
] as const;

// A strength-scaled one-hot block: sqrt(weight)·magnitude on the active slot,
// zeros elsewhere (and all zeros when value is an absence → null).
function scaledOneHot(
  slots: readonly string[],
  value: string | null,
  magnitude: number,
  weight: number,
): number[] {
  const w = Math.sqrt(weight);
  return slots.map((s) => (value !== null && s === value ? w * magnitude : 0));
}

// Encode the 6 levers into a single non-negative feature vector (dim = 21:
// 3+6+1[incentive magnitude axis]+6+2+3). Strength comes from weights.strengthOf,
// normalized to [0,1] by /3.
export function encodeLevers(levers: Levers): number[] {
  const s = strengthOf(levers);
  const urgency = scaledOneHot(
    URGENCY_SLOTS,
    levers.urgency.tactic === "none" ? null : levers.urgency.tactic,
    s.urgency / 3,
    LEVER_WEIGHTS.urgency,
  );
  const authority = scaledOneHot(
    AUTHORITY_SLOTS,
    levers.authority.impersonates === "none"
      ? null
      : levers.authority.impersonates,
    s.authority / 3,
    LEVER_WEIGHTS.authority,
  );
  // incentive (decision B): one shared magnitude axis, so reward↔fear is
  // structurally invisible; only intensity (via strengthOf) moves it.
  const incentive = [Math.sqrt(LEVER_WEIGHTS.incentive) * (s.incentive / 3)];
  const callToAction = scaledOneHot(
    CTA_SLOTS,
    levers.callToAction.action,
    s.callToAction / 3,
    LEVER_WEIGHTS.callToAction,
  );
  const personalization = scaledOneHot(
    PERSONALIZATION_SLOTS,
    levers.personalization.level === "broadcast"
      ? null
      : levers.personalization.level,
    s.personalization / 3,
    LEVER_WEIGHTS.personalization,
  );
  const isolation = scaledOneHot(
    ISOLATION_SLOTS,
    levers.isolation.tactic === "none" ? null : levers.isolation.tactic,
    s.isolation / 3,
    LEVER_WEIGHTS.isolation,
  );
  return [
    ...urgency,
    ...authority,
    ...incentive,
    ...callToAction,
    ...personalization,
    ...isolation,
  ];
}

// Weighted cosine of two lever encodings, in [0,1]. Returns 0 when either
// operand is the zero vector (an all-absence pattern carries no active signal,
// so it matches nothing — consistent with the discrete rule's 0/6). Guards the
// 0/0 that a raw cosine would produce.
export function leverSimilarity(a: Levers, b: Levers): number {
  const va = encodeLevers(a);
  const vb = encodeLevers(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i];
    na += va[i] * va[i];
    nb += vb[i] * vb[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

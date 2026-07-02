import type { AttackPattern } from "@/types/attackPattern";
import { listAttackPatterns } from "@/lib/firestore";
import { leverSimilarity } from "@/lib/leverVector";
import type { KnownScamMatch } from "@/types/investigation";

// Hit threshold for "this matches a known scam pattern". Now a WEIGHTED-COSINE
// threshold (leverVector.leverSimilarity ∈ [0,1]), not a fraction-of-6 count.
// PROVISIONAL value: 0.5 is a placeholder for the dense scale pending the
// offline sweep in scripts/calibrateKnownScamThreshold.ts, which picks τ to
// maximize scam recall subject to no effective-band FPR regression on the real
// holdout. Do NOT treat 0.5 as calibrated. NOTE (lockstep debt): generalization
// Check.ts still mirrors the OLD discrete numerator; migrate it to leverSimilarity
// in the same change that finalizes τ from the sweep.
export const KNOWN_SCAM_HIT_THRESHOLD = 0.5;
export const KNOWN_SCAM_MAX_MATCHES = 5;

// Single source for the match shape — see KnownScamMatch in types/investigation.ts.
// Kept as a re-export so existing imports of `ScamMatch` from this module
// continue to compile if any external code references them.
export type ScamMatch = KnownScamMatch;

export type MatchKnownScamsResult =
  | { ok: true; matches: KnownScamMatch[] }
  | { ok: false; reason: string };

// Similarity is now leverVector.leverSimilarity: a weighted cosine over
// strength-scaled one-hot lever blocks (@/lib/leverVector). It preserves every
// principle of the old discrete "active matched / 6" rule but as a CONTINUOUS
// measure, so near-misses the 3/6 cutoff dropped can now clear the threshold:
//  - absence (urgency/isolation "none", authority "none", personalization
//    "broadcast") encodes to a zero block ⇒ contributes 0, same as the old
//    "artifact" exclusion;
//  - the incentive reward/fear coin-flip is structurally invisible (a single
//    shared magnitude axis) ⇒ a byte-identical pattern scores 1.0, and so does
//    one differing ONLY in incentive.type — a stronger form of "coin-flip never
//    credited" than the old 5/6;
//  - LEVER_WEIGHTS drive the cosine, so heavy levers (isolation, callToAction,
//    personalization) dominate — principled, holdout-independent.
// Structural non-inflation: cosine ≤ 1 caps any single doc's contribution and
// the downstream bonus is count-capped (weights.ts), so the change cannot
// manufacture recall on known cases.

export async function matchKnownScams(args: {
  levers: AttackPattern["levers"];
}): Promise<MatchKnownScamsResult> {
  try {
    const patterns = await listAttackPatterns();
    const matches: KnownScamMatch[] = [];
    for (const p of patterns) {
      const s = leverSimilarity(args.levers, p.levers);
      if (s >= KNOWN_SCAM_HIT_THRESHOLD) {
        matches.push({ id: p.id, similarity: s });
      }
    }
    matches.sort((x, y) => y.similarity - x.similarity);
    return { ok: true, matches: matches.slice(0, KNOWN_SCAM_MAX_MATCHES) };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, reason };
  }
}

import type { AttackPattern } from "@/types/attackPattern";
import { listAttackPatterns } from "@/lib/firestore";
import { LEVER_KEYS, classifyMatchedLever, mainValue } from "@/lib/levers";
import type { KnownScamMatch } from "@/types/investigation";

// Hit threshold for "this matches a known scam pattern". 0.5 = at least 3 of
// 6 ACTIVE main-enum values match. Below this is treated as noise; without the
// threshold a freshly-seeded scam corpus would match every pattern at 0/6 = 0
// similarity once we start adding patterns with sparse enum overlap.
export const KNOWN_SCAM_HIT_THRESHOLD = 0.5;
export const KNOWN_SCAM_MAX_MATCHES = 5;

// Single source for the match shape — see KnownScamMatch in types/investigation.ts.
// Kept as a re-export so existing imports of `ScamMatch` from this module
// continue to compile if any external code references them.
export type ScamMatch = KnownScamMatch;

export type MatchKnownScamsResult =
  | { ok: true; matches: KnownScamMatch[] }
  | { ok: false; reason: string };

// T5 pillar-1 (ii): the numerator counts ACTIVE matched levers only. A matched
// lever is credited only when classifyMatchedLever marks it active — i.e. it
// reflects an attacker's deliberate choice. Artifact matches (incentive.type's
// reward/fear coin-flip; absence matches like urgency/isolation "none",
// personalization "broadcast", authority "none") are NOT evidence the detector
// recognized an attack structure, so they contribute 0.
//
// This is a PRINCIPLE-driven change, not holdout fitting: "absence and a
// coin-flip are not evidence" is stated independently of any holdout, and it
// can only LOWER similarity (the numerator shrinks) — it is structurally unable
// to inflate recall on known cases. It is the detector-side mirror of the
// evaluation-side strictening validated in T2-③ (generalizationCheck).
//
// The denominator stays fixed at LEVER_KEYS.length (6) — NOT the count of
// active-capable levers — so the 0.5 threshold keeps a single, pattern-
// independent meaning (shrinking the denominator per pattern would make the
// threshold easier for absence-heavy patterns = a tuning knob we refuse).
function similarity(
  a: AttackPattern["levers"],
  b: AttackPattern["levers"],
): number {
  let matched = 0;
  for (const key of LEVER_KEYS) {
    const va = mainValue(key, a);
    if (va === mainValue(key, b) && classifyMatchedLever(key, va) === "active") {
      matched += 1;
    }
  }
  return matched / LEVER_KEYS.length;
}

export async function matchKnownScams(args: {
  levers: AttackPattern["levers"];
}): Promise<MatchKnownScamsResult> {
  try {
    const patterns = await listAttackPatterns();
    const matches: KnownScamMatch[] = [];
    for (const p of patterns) {
      const s = similarity(args.levers, p.levers);
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

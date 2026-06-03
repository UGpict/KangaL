import type { AttackPattern } from "@/types/attackPattern";
import { listAttackPatterns } from "@/lib/firestore";
import { LEVER_WEIGHTS, type LeverKey } from "@/lib/weights";

// Single source of truth for lever count — never hardcode /6. Adding a 7th
// lever (unlikely but possible) propagates automatically through this and
// the similarity computation.
const LEVER_KEYS = Object.keys(LEVER_WEIGHTS) as LeverKey[];

// Hit threshold for "this matches a known scam pattern". 0.5 = at least 3 of
// 6 main-enum values match. Below this is treated as noise; without the
// threshold a freshly-seeded scam corpus would match every pattern at 0/6 = 0
// similarity once we start adding patterns with sparse enum overlap.
export const KNOWN_SCAM_HIT_THRESHOLD = 0.5;
export const KNOWN_SCAM_MAX_MATCHES = 5;

export type ScamMatch = { id: string; similarity: number };

export type MatchKnownScamsResult =
  | { ok: true; matches: ScamMatch[] }
  | { ok: false; reason: string };

// FUTURE: replace with vector-search similarity (Vertex Text Embeddings +
// Firestore vector field) once the scam corpus is large enough that
// enum-only overlap misses semantically-equivalent attacks. For MVP we use
// the dominant enum value of each lever — fast, deterministic, and good
// enough to demonstrate the routing.
function mainValue(
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

function similarity(
  a: AttackPattern["levers"],
  b: AttackPattern["levers"],
): number {
  let matched = 0;
  for (const key of LEVER_KEYS) {
    if (mainValue(key, a) === mainValue(key, b)) matched += 1;
  }
  return matched / LEVER_KEYS.length;
}

export async function matchKnownScams(args: {
  levers: AttackPattern["levers"];
}): Promise<MatchKnownScamsResult> {
  try {
    const patterns = await listAttackPatterns();
    const matches: ScamMatch[] = [];
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

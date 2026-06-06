import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackPattern } from "@/types/attackPattern";
import { exampleAttackPattern } from "@/types/__fixtures__/attackPattern.example";

vi.mock("@/lib/firestore", () => ({
  listAttackPatterns: vi.fn(),
}));

import { listAttackPatterns } from "@/lib/firestore";
import {
  KNOWN_SCAM_HIT_THRESHOLD,
  matchKnownScams,
} from "../matchKnownScams";

function patternWithLevers(
  id: string,
  levers: AttackPattern["levers"],
): AttackPattern {
  return { ...exampleAttackPattern, id, levers };
}

const BASE_LEVERS = exampleAttackPattern.levers;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("matchKnownScams", () => {
  it("returns empty matches when the attackPatterns collection is empty", async () => {
    vi.mocked(listAttackPatterns).mockResolvedValue([]);
    const result = await matchKnownScams({ levers: BASE_LEVERS });
    expect(result).toEqual({ ok: true, matches: [] });
  });

  it("scores an exact match at 5/6, not 1.0 — the incentive coin-flip is never credited", async () => {
    // T5 pillar-1 (ii): similarity counts ACTIVE matched levers only. BASE_LEVERS
    // has 5 active main-values (urgency/authority/callToAction/personalization/
    // isolation) + 1 artifact (incentive.type = fear, a reward/fear coin-flip).
    // Even a byte-identical pattern matches on 5/6 because the coin-flip lever is
    // structurally excluded from the numerator (denominator stays 6).
    vi.mocked(listAttackPatterns).mockResolvedValue([
      patternWithLevers("p-exact", BASE_LEVERS),
    ]);
    const result = await matchKnownScams({ levers: BASE_LEVERS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].id).toBe("p-exact");
      expect(result.matches[0].similarity).toBeCloseTo(5 / 6, 10);
    }
  });

  it("includes patterns at or above the hit threshold and excludes the rest", async () => {
    // 3 of 6 main values changed → similarity = 0.5 (== threshold, included)
    const halfMatch: AttackPattern["levers"] = {
      ...BASE_LEVERS,
      urgency: { tactic: "account_freeze", intensity: 1 },
      authority: { impersonates: "financial", credibilityTricks: [] },
      incentive: { type: "reward", hook: "prize", intensity: 1 },
    };
    // 5 of 6 main values changed → similarity = 1/6 ≈ 0.167 (below threshold)
    const dissimilar: AttackPattern["levers"] = {
      urgency: { tactic: "limited_offer", intensity: 1 },
      authority: { impersonates: "delivery", credibilityTricks: [] },
      incentive: { type: "reward", hook: "prize", intensity: 1 },
      callToAction: { action: "click_link", friction: "high" },
      personalization: { level: "broadcast", signals: [] },
      isolation: BASE_LEVERS.isolation, // matches base
    };
    vi.mocked(listAttackPatterns).mockResolvedValue([
      patternWithLevers("p-half", halfMatch),
      patternWithLevers("p-dissimilar", dissimilar),
    ]);
    const result = await matchKnownScams({ levers: BASE_LEVERS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches.map((m) => m.id)).toEqual(["p-half"]);
      expect(result.matches[0].similarity).toBe(0.5);
    }
    expect(KNOWN_SCAM_HIT_THRESHOLD).toBe(0.5);
  });

  it("sorts matches by similarity descending and caps the list", async () => {
    vi.mocked(listAttackPatterns).mockResolvedValue([
      patternWithLevers("p-half", {
        ...BASE_LEVERS,
        urgency: { tactic: "account_freeze", intensity: 1 },
        authority: { impersonates: "financial", credibilityTricks: [] },
        incentive: { type: "reward", hook: "prize", intensity: 1 },
      }),
      patternWithLevers("p-exact", BASE_LEVERS),
    ]);
    const result = await matchKnownScams({ levers: BASE_LEVERS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches.map((m) => m.id)).toEqual(["p-exact", "p-half"]);
    }
  });

  it("returns ok:false when Firestore throws", async () => {
    vi.mocked(listAttackPatterns).mockRejectedValue(
      new Error("firestore unavailable"),
    );
    const result = await matchKnownScams({ levers: BASE_LEVERS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("firestore unavailable");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackPattern } from "@/types/attackPattern";
import { exampleAttackPattern } from "@/types/__fixtures__/attackPattern.example";

vi.mock("@/lib/firestore", () => ({
  listAttackPatterns: vi.fn(),
}));

import { listAttackPatterns } from "@/lib/firestore";
import {
  KNOWN_SCAM_HIT_THRESHOLD,
  KNOWN_SCAM_MAX_MATCHES,
  matchKnownScams,
} from "../matchKnownScams";

type Levers = AttackPattern["levers"];

function patternWithLevers(id: string, levers: Levers): AttackPattern {
  return { ...exampleAttackPattern, id, levers };
}

const BASE_LEVERS = exampleAttackPattern.levers;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("matchKnownScams (dense weighted-cosine similarity)", () => {
  it("returns empty matches when the attackPatterns collection is empty", async () => {
    vi.mocked(listAttackPatterns).mockResolvedValue([]);
    const result = await matchKnownScams({ levers: BASE_LEVERS });
    expect(result).toEqual({ ok: true, matches: [] });
  });

  it("scores a byte-identical pattern at 1.0 — and one differing ONLY in the incentive coin-flip also 1.0", async () => {
    // Dense cosine of identical encodings is 1. Because incentive uses a single
    // shared magnitude axis (decision B), flipping reward↔fear leaves the vector
    // unchanged — the coin-flip is structurally invisible (stronger than the old
    // 5/6 exclusion).
    const coinFlipped: Levers = {
      ...BASE_LEVERS,
      incentive: {
        ...BASE_LEVERS.incentive,
        type: BASE_LEVERS.incentive.type === "fear" ? "reward" : "fear",
      },
    };
    vi.mocked(listAttackPatterns).mockResolvedValue([
      patternWithLevers("p-exact", BASE_LEVERS),
      patternWithLevers("p-coinflip", coinFlipped),
    ]);
    const result = await matchKnownScams({ levers: BASE_LEVERS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches).toHaveLength(2);
      for (const m of result.matches) expect(m.similarity).toBeCloseTo(1, 10);
    }
  });

  it("recovers a near-miss the discrete 3/6 rule dropped, and still excludes a genuinely dissimilar pattern", async () => {
    // near-miss: shares only the HEAVY levers with BASE (isolation secrecy/3 +
    // callToAction transfer_money/low), differs on the light ones. Old rule:
    // 2 active matches = 2/6 < 0.5 ⇒ EXCLUDED. Dense: heavy-lever overlap
    // dominates ⇒ INCLUDED. This is the recall the upgrade exists for.
    const nearMiss: Levers = {
      urgency: { tactic: "none", intensity: 0 },
      authority: { impersonates: "financial", credibilityTricks: [] },
      incentive: { type: "reward", hook: "prize", intensity: 0 },
      callToAction: { action: "transfer_money", friction: "low" },
      personalization: { level: "broadcast", signals: [] },
      isolation: { tactic: "secrecy", intensity: 3 },
    };
    // dissimilar: shares only one light lever (urgency deadline/2). Excluded
    // under both the old and the dense rule.
    const dissimilar: Levers = {
      urgency: { tactic: "deadline", intensity: 2 },
      authority: { impersonates: "financial", credibilityTricks: [] },
      incentive: { type: "reward", hook: "prize", intensity: 0 },
      callToAction: { action: "click_link", friction: "high" },
      personalization: { level: "broadcast", signals: [] },
      isolation: { tactic: "none", intensity: 0 },
    };
    vi.mocked(listAttackPatterns).mockResolvedValue([
      patternWithLevers("p-nearmiss", nearMiss),
      patternWithLevers("p-dissimilar", dissimilar),
    ]);
    const result = await matchKnownScams({ levers: BASE_LEVERS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches.map((m) => m.id)).toEqual(["p-nearmiss"]);
      const s = result.matches[0].similarity;
      expect(s).toBeGreaterThanOrEqual(KNOWN_SCAM_HIT_THRESHOLD);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("sorts matches by similarity descending", async () => {
    const nearMiss: Levers = {
      urgency: { tactic: "none", intensity: 0 },
      authority: { impersonates: "financial", credibilityTricks: [] },
      incentive: { type: "reward", hook: "prize", intensity: 0 },
      callToAction: { action: "transfer_money", friction: "low" },
      personalization: { level: "broadcast", signals: [] },
      isolation: { tactic: "secrecy", intensity: 3 },
    };
    vi.mocked(listAttackPatterns).mockResolvedValue([
      patternWithLevers("p-nearmiss", nearMiss),
      patternWithLevers("p-exact", BASE_LEVERS),
    ]);
    const result = await matchKnownScams({ levers: BASE_LEVERS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches.map((m) => m.id)).toEqual(["p-exact", "p-nearmiss"]);
    }
  });

  it("caps the returned list at KNOWN_SCAM_MAX_MATCHES", async () => {
    // 6 byte-identical corpus docs all score 1.0; only the cap should trim them.
    vi.mocked(listAttackPatterns).mockResolvedValue(
      Array.from({ length: KNOWN_SCAM_MAX_MATCHES + 1 }, (_, i) =>
        patternWithLevers(`p-${i}`, BASE_LEVERS),
      ),
    );
    const result = await matchKnownScams({ levers: BASE_LEVERS });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.matches).toHaveLength(KNOWN_SCAM_MAX_MATCHES);
  });

  it("threshold is a cosine gate in (0,1)", () => {
    // Provisional pending scripts/calibrateKnownScamThreshold.ts — asserted for
    // range/role only, never pinned to a hand-tuned literal.
    expect(KNOWN_SCAM_HIT_THRESHOLD).toBeGreaterThan(0);
    expect(KNOWN_SCAM_HIT_THRESHOLD).toBeLessThan(1);
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

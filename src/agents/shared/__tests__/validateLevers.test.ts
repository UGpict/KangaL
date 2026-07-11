import { describe, expect, it } from "vitest";
import { isLeversShape } from "../validateLevers";
import type { AttackPattern } from "@/types/attackPattern";

// Typed fixture = free compile-time drift check: if the levers type gains a
// field, this file stops compiling before any runtime test runs.
const VALID: AttackPattern["levers"] = {
  urgency: { tactic: "deadline", intensity: 2 },
  authority: {
    impersonates: "financial",
    credibilityTricks: ["formal_tone", "reference_number"],
  },
  incentive: { type: "fear", hook: "account_loss", intensity: 2 },
  callToAction: { action: "input_credentials", friction: "low" },
  personalization: { level: "targeted", signals: ["real_name"] },
  isolation: { tactic: "secrecy", intensity: 1 },
};

// structuredClone so each case mutates its own copy; the mutation callback
// gets an untyped view because the whole point is to build off-type shapes.
function mutate(
  fn: (levers: Record<string, Record<string, unknown>>) => void,
): unknown {
  const clone = structuredClone(VALID) as unknown as Record<
    string,
    Record<string, unknown>
  >;
  fn(clone);
  return clone;
}

describe("isLeversShape (deep validation)", () => {
  it("accepts a fully valid levers object", () => {
    expect(isLeversShape(VALID)).toBe(true);
  });

  it("accepts intensity boundaries 0 and 3", () => {
    expect(
      isLeversShape(
        mutate((l) => {
          l.urgency.intensity = 0;
          l.incentive.intensity = 3;
          l.isolation.intensity = 3;
        }),
      ),
    ).toBe(true);
  });

  it("accepts empty enum arrays (pins NEUTRAL_LEVERS / fallbackSeed shapes)", () => {
    // The degraded paths in analyzeStructure and attacker emit levers with
    // empty credibilityTricks/signals — the validator must never reject them.
    expect(
      isLeversShape(
        mutate((l) => {
          l.authority.credibilityTricks = [];
          l.personalization.signals = [];
        }),
      ),
    ).toBe(true);
  });

  it("rejects non-object inputs", () => {
    expect(isLeversShape(null)).toBe(false);
    expect(isLeversShape(undefined)).toBe(false);
    expect(isLeversShape("levers")).toBe(false);
    expect(isLeversShape(42)).toBe(false);
    expect(isLeversShape([])).toBe(false);
  });

  it("rejects a missing lever key", () => {
    expect(
      isLeversShape(
        mutate((l) => {
          delete (l as Record<string, unknown>).isolation;
        }),
      ),
    ).toBe(false);
  });

  it("rejects an extra top-level key", () => {
    expect(
      isLeversShape(
        mutate((l) => {
          (l as Record<string, unknown>).craftedText = "至急ご対応ください";
        }),
      ),
    ).toBe(false);
  });

  it("rejects a null lever", () => {
    expect(
      isLeversShape(
        mutate((l) => {
          (l as Record<string, unknown>).urgency = null;
        }),
      ),
    ).toBe(false);
  });

  it("rejects a missing field inside a lever", () => {
    expect(
      isLeversShape(
        mutate((l) => {
          delete l.urgency.intensity;
        }),
      ),
    ).toBe(false);
  });

  it("rejects an extra nested key (道B: no free-text smuggling)", () => {
    expect(
      isLeversShape(
        mutate((l) => {
          l.urgency.craftedText = "至急振込";
        }),
      ),
    ).toBe(false);
  });

  it("rejects an off-enum string", () => {
    expect(
      isLeversShape(
        mutate((l) => {
          l.urgency.tactic = "very urgent";
        }),
      ),
    ).toBe(false);
  });

  it.each([[4], [-1], [1.5], ["2"], ["very high"], [Number.NaN]])(
    "rejects invalid intensity %j (the NaN fail-open path)",
    (bad) => {
      expect(
        isLeversShape(
          mutate((l) => {
            l.urgency.intensity = bad;
          }),
        ),
      ).toBe(false);
    },
  );

  it("rejects a non-array credibilityTricks", () => {
    expect(
      isLeversShape(
        mutate((l) => {
          l.authority.credibilityTricks = "formal_tone";
        }),
      ),
    ).toBe(false);
  });

  it("rejects an array containing an off-enum member", () => {
    expect(
      isLeversShape(
        mutate((l) => {
          l.authority.credibilityTricks = ["formal_tone", "fake_seal"];
        }),
      ),
    ).toBe(false);
  });

  it("rejects duplicate array entries (they'd inflate authority strength)", () => {
    expect(
      isLeversShape(
        mutate((l) => {
          l.authority.credibilityTricks = ["formal_tone", "formal_tone"];
        }),
      ),
    ).toBe(false);
  });

  it("rejects an off-enum member in personalization.signals (both arrays checked)", () => {
    expect(
      isLeversShape(
        mutate((l) => {
          l.personalization.signals = ["real_name", "home_address"];
        }),
      ),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { AttackPattern } from "@/types/attackPattern";
import { judge } from "../judge";

const RUN_INTEGRATION = process.env.INTEGRATION === "1";

const BEC_LEVERS: AttackPattern["levers"] = {
  urgency: { tactic: "deadline", intensity: 3 },
  authority: {
    impersonates: "business_partner",
    credibilityTricks: ["formal_tone"],
  },
  incentive: { type: "fear", hook: "penalty", intensity: 2 },
  callToAction: { action: "transfer_money", friction: "low" },
  personalization: { level: "targeted", signals: ["real_name"] },
  isolation: { tactic: "secrecy", intensity: 3 },
};

describe.skipIf(!RUN_INTEGRATION)(
  "judge (integration, real Vertex AI)",
  () => {
    it(
      "BEC levers → score 92 / isolationNote contract / natural non-alarmist Japanese reason",
      async () => {
        const result = await judge(BEC_LEVERS);
        // Score is deterministic — same exact value as the unit test.
        expect(result.score).toBe(92);
        // isolation note is guaranteed by the field contract, not by parsing reason.
        expect(result.isolationNote).not.toBeNull();
        expect(result.isolationNote).toContain("孤立化");
        // Gemini's reason must follow §7 tone: no alarmist absolutes, meaningful length.
        expect(result.reason).not.toContain("絶対詐欺");
        expect(result.reason).not.toContain("100%");
        expect(result.reason.length).toBeGreaterThan(20);
      },
      30_000,
    );
  },
);

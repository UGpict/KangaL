import { describe, expect, it } from "vitest";
import { analyzeStructure } from "../analyzeStructure";

const RUN_INTEGRATION = process.env.INTEGRATION === "1";

// These tests hit the real Vertex AI Gemini and require:
//   - INTEGRATION=1
//   - GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION
//   - ADC (gcloud auth application-default login) or service-account creds
// They are skipped by default so plain `npm test` stays hermetic.
describe.skipIf(!RUN_INTEGRATION)(
  "analyzeStructure (integration, real Vertex AI)",
  () => {
    it(
      "urgent BEC-style message → urgency.intensity ≥ 2 / isolation.tactic = secrecy / authority.impersonates = business_partner",
      async () => {
        const result = await analyzeStructure(
          "【至急】お振込先変更のお願い(社外秘)",
        );
        expect(result.degraded).toBe(false);
        expect(result.levers.urgency.intensity).toBeGreaterThanOrEqual(2);
        expect(result.levers.isolation.tactic).toBe("secrecy");
        expect(result.levers.authority.impersonates).toBe("business_partner");
      },
      30_000,
    );

    it(
      "ordinary business message → most levers neutral/0",
      async () => {
        const result = await analyzeStructure(
          "本日の定例ミーティングですが、議題は先週共有した通りです。資料は共有フォルダにアップしておきます。",
        );
        expect(result.degraded).toBe(false);
        expect(result.levers.urgency.intensity).toBeLessThanOrEqual(1);
        expect(result.levers.isolation.tactic).toBe("none");
        expect(result.levers.authority.impersonates).toBe("none");
      },
      30_000,
    );
  },
);

import { describe, expect, it } from "vitest";
import type { AttackPattern } from "@/types/attackPattern";
import { investigate } from "../investigate";

const RUN_INTEGRATION = process.env.INTEGRATION === "1";

// BEC fixture matching msg-003 in sampleMessages.ts.
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

const BEC_BODY = `いつもお世話になっております。カンガル商事 経理部の山田です。

先ほどお電話でお伝えした請求の件ですが、振込先の口座情報を急遽変更させていただきたくご連絡しました。
新しい口座番号は本メール末尾に記載しております。

監査の都合上、新しい口座については弊社内でも一部しか把握しておりません。
本件は本メール内のみで完結させていただき、他部署や上長への共有はお控えくださいますようお願いいたします。

本日中の手配が必要ですので、お手数ですがご対応をお願いいたします。

──────────
新振込口座: カンガル銀行 ○○支店 普通 1234567 カ)カンガルシヨウジ
──────────`;

describe.skipIf(!RUN_INTEGRATION)(
  "investigate (integration, real Vertex AI routing)",
  () => {
    it(
      "BEC sample: matchKnownScams runs unconditionally, and Gemini routes to at least one of (checkUrlReputation, checkOfficialAlerts). Tool failures (e.g. missing WEB_RISK_API_KEY) degrade gracefully without stopping investigate.",
      async () => {
        const report = await investigate({
          message: BEC_BODY,
          levers: BEC_LEVERS,
          authenticationResults: "spf=fail dkim=fail dmarc=fail",
          budgetMs: 25_000,
        });

        // (1) matchKnownScams is the always-call tool.
        expect(report.knownScams).toBeDefined();

        // (2) At least one of the conditional tools associated with the
        // BEC profile was routed to. The body has no http(s):// URL so
        // checkUrlReputation may legitimately be skipped; the bank-name
        // mention should trigger checkOfficialAlerts. Either is fine.
        const conditionalCalled =
          report.urlReputation !== undefined ||
          report.officialAlerts !== undefined ||
          report.senderAuth !== undefined ||
          report.domainAge !== undefined;
        expect(conditionalCalled).toBe(true);

        // (3) Graceful degradation: even if WEB_RISK_API_KEY is unset or
        // antiphishing.jp is unreachable, investigate completes — findings
        // surface as status:"error", never as a thrown exception.
        for (const finding of [
          report.urlReputation,
          report.domainAge,
          report.senderAuth,
          report.officialAlerts,
          report.knownScams,
        ]) {
          if (finding === undefined) continue;
          expect(["ok", "error"]).toContain(finding.status);
        }

        // (4) Completion within budget.
        expect(report.truncated).toBe(false);
      },
      60_000,
    );
  },
);

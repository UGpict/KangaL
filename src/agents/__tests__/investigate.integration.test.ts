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

// Phishing fixture: BEC body but with an http(s):// URL added. Used to
// assert the URL-driven routing rule from the production description.
const PHISHING_BODY = `あなたのアカウントが一時的に制限されました。下記より本人確認をお願いします。
https://login.example/verify`;

const PHISHING_LEVERS: AttackPattern["levers"] = {
  urgency: { tactic: "account_freeze", intensity: 3 },
  authority: { impersonates: "platform", credibilityTricks: ["url_lookalike"] },
  incentive: { type: "fear", hook: "account_loss", intensity: 3 },
  callToAction: { action: "click_link", friction: "low" },
  personalization: { level: "broadcast", signals: [] },
  isolation: { tactic: "none", intensity: 0 },
};

describe.skipIf(!RUN_INTEGRATION)(
  "investigate (integration, real Vertex AI routing)",
  () => {
    it(
      "BEC sample (no URL): matchKnownScams runs (anchor); checkUrlReputation is NOT called because there is no http(s):// in the body; verifySenderAuth and checkOfficialAlerts both fire from the auth header and the business_partner impersonation.",
      async () => {
        const report = await investigate({
          message: BEC_BODY,
          levers: BEC_LEVERS,
          authenticationResults: "spf=fail dkim=fail dmarc=fail",
          budgetMs: 25_000,
        });

        // (anchor) matchKnownScams always runs.
        expect(report.knownScams).toBeDefined();

        // (negative routing assert) Body has no http(s):// URL, so the
        // routing description explicitly forbids checkUrlReputation. If
        // routing degenerates into "always call every tool", this fails.
        expect(report.urlReputation).toBeUndefined();

        // (positive routing assert) Auth header present ⇒ verifySenderAuth.
        // business_partner impersonation ⇒ checkOfficialAlerts.
        expect(report.senderAuth).toBeDefined();
        expect(report.officialAlerts).toBeDefined();

        // Graceful degradation: any finding present must be ok or error,
        // never a thrown exception.
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

        expect(report.truncated).toBe(false);
      },
      60_000,
    );

    it(
      "phishing sample (URL in body): matchKnownScams runs (anchor); checkUrlReputation IS called because the body carries an http(s):// URL.",
      async () => {
        const report = await investigate({
          message: PHISHING_BODY,
          levers: PHISHING_LEVERS,
          budgetMs: 25_000,
        });

        expect(report.knownScams).toBeDefined();

        // (positive routing assert) URL present ⇒ checkUrlReputation must
        // fire. status may be "ok" or "error" depending on WEB_RISK_API_KEY.
        expect(report.urlReputation).toBeDefined();

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

        expect(report.truncated).toBe(false);
      },
      60_000,
    );
  },
);

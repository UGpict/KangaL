import { describe, expect, it } from "vitest";
import { buildFallbackReason } from "../fallbackReason";
import type { AttackPattern } from "@/types/attackPattern";
import type { InvestigationReport } from "@/types/investigation";

// Fixtures mirror judge.test.ts so the deterministic reason is exercised on
// the same shapes the judge tests use.
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

function leversFromOverrides(
  overrides: Partial<AttackPattern["levers"]> = {},
): AttackPattern["levers"] {
  return {
    urgency: { tactic: "none", intensity: 0 },
    authority: { impersonates: "none", credibilityTricks: [] },
    incentive: { type: "reward", hook: "prize", intensity: 0 },
    callToAction: { action: "click_link", friction: "high" },
    personalization: { level: "broadcast", signals: [] },
    isolation: { tactic: "none", intensity: 0 },
    ...overrides,
  };
}

function reportFrom(
  partial: Partial<InvestigationReport>,
): InvestigationReport {
  return {
    truncated: false,
    truncatedReason: null,
    bonus: { items: [], total: 0, capped: false },
    ...partial,
  };
}

const URGENCY_ONLY = leversFromOverrides({
  urgency: { tactic: "deadline", intensity: 2 },
});

describe("buildFallbackReason — danger band", () => {
  it("names the top strength×weight lever clauses for the BEC pattern", () => {
    const reason = buildFallbackReason(BEC_LEVERS, 92);
    // Top 3 by strength×weight: callToAction 9, personalization 9, urgency 6.
    expect(reason).toContain("送金を求めている");
    expect(reason).toContain("あなた個人に関する情報");
    expect(reason).toContain("期限を区切って");
    expect(reason).toContain("注意");
  });

  it("caps at 3 lever clauses (authority, 4th by weight, is dropped)", () => {
    const reason = buildFallbackReason(BEC_LEVERS, 92);
    expect(reason).not.toContain("取引先を名乗っている");
  });

  it("leaves isolation to isolationNote when other levers are active", () => {
    const reason = buildFallbackReason(BEC_LEVERS, 92);
    expect(reason).not.toContain("誰にも話さない");
  });

  it("uses the isolation phrase when isolation is the ONLY active lever (floor-driven danger)", () => {
    const levers = leversFromOverrides({
      isolation: { tactic: "secrecy", intensity: 3 },
    });
    // ISOLATION_FLOORS[3] = 75 → danger band with an otherwise empty pool;
    // without the exception the red card would explain nothing.
    const reason = buildFallbackReason(levers, 75);
    expect(reason).toContain("誰にも話さないよう求めている");
  });

  it("suggests rather than commands (§7 tone)", () => {
    const reason = buildFallbackReason(BEC_LEVERS, 92);
    expect(reason).toContain("確認してみましょう");
  });
});

describe("buildFallbackReason — no fabrication", () => {
  it("never mentions inactive levers", () => {
    const reason = buildFallbackReason(URGENCY_ONLY, 12);
    expect(reason).not.toContain("名乗っている");
    expect(reason).not.toContain("送金");
    expect(reason).not.toContain("誰にも話さない");
  });
});

describe("buildFallbackReason — safe band", () => {
  it("with an active lever: states the observation without asserting danger or safety", () => {
    const reason = buildFallbackReason(URGENCY_ONLY, 12);
    expect(reason).toContain("期限を区切って");
    expect(reason).toContain("気になる点");
    expect(reason).not.toContain("詐欺です");
    expect(reason).not.toContain("安全です");
  });

  it("with zero active levers: honest zero-signal text, still no absolute-safety claim", () => {
    const reason = buildFallbackReason(leversFromOverrides(), 0);
    expect(reason).toContain("はっきりした特徴は見つかりませんでした");
    expect(reason).not.toContain("安全です");
  });

  it("isolation-only at low intensity (no floor) falls back to the zero-signal text", () => {
    const levers = leversFromOverrides({
      isolation: { tactic: "secrecy", intensity: 1 },
    });
    // Score 10 → safe band. isolationNote carries the caveat independently;
    // the reason must not duplicate it.
    const reason = buildFallbackReason(levers, 10);
    expect(reason).toContain("はっきりした特徴は見つかりませんでした");
    expect(reason).not.toContain("誰にも話さない");
  });
});

describe("buildFallbackReason — investigation clause", () => {
  it("appends at most one clause, in bonus-priority order (webRisk beats domainAge)", () => {
    const report = reportFrom({
      urlReputation: { status: "ok", threats: ["SOCIAL_ENGINEERING"] },
      domainAge: { status: "ok", domain: "young.example", ageDays: 2 },
    });
    const reason = buildFallbackReason(BEC_LEVERS, 92, report);
    expect(reason).toContain("安全でない可能性");
    expect(reason).not.toContain("日しか経っていません");
  });

  it("interpolates numbers only: ageDays appears, the domain string never does", () => {
    const report = reportFrom({
      domainAge: { status: "ok", domain: "young.example", ageDays: 2 },
    });
    const reason = buildFallbackReason(BEC_LEVERS, 92, report);
    expect(reason).toContain("2日しか経っていません");
    expect(reason).not.toContain("young.example");
  });

  it("uses the same trigger conditions as the bonus: an old domain produces no clause", () => {
    const report = reportFrom({
      domainAge: { status: "ok", domain: "old.example", ageDays: 30 },
    });
    const reason = buildFallbackReason(BEC_LEVERS, 92, report);
    expect(reason).not.toContain("日しか経っていません");
  });

  it("never interpolates official-alert titles (external text)", () => {
    const report = reportFrom({
      officialAlerts: {
        status: "ok",
        matches: [
          { title: "カンガル銀行を装う詐欺", url: "https://alert.example" },
        ],
      },
    });
    const reason = buildFallbackReason(BEC_LEVERS, 92, report);
    expect(reason).toContain("注意を呼びかけている");
    expect(reason).not.toContain("カンガル銀行");
    expect(reason).not.toContain("alert.example");
  });

  it("interpolates the known-scam match count", () => {
    const report = reportFrom({
      knownScams: {
        status: "ok",
        matches: [
          { id: "a", similarity: 0.9 },
          { id: "b", similarity: 0.8 },
        ],
      },
    });
    const reason = buildFallbackReason(BEC_LEVERS, 92, report);
    expect(reason).toContain("2件");
  });
});

describe("buildFallbackReason — determinism", () => {
  it("same inputs produce the identical string", () => {
    const report = reportFrom({
      urlReputation: { status: "ok", threats: ["SOCIAL_ENGINEERING"] },
    });
    expect(buildFallbackReason(BEC_LEVERS, 92, report)).toBe(
      buildFallbackReason(BEC_LEVERS, 92, report),
    );
  });

  it("is never empty in any band", () => {
    expect(buildFallbackReason(BEC_LEVERS, 92).length).toBeGreaterThan(0);
    expect(buildFallbackReason(URGENCY_ONLY, 12).length).toBeGreaterThan(0);
    expect(
      buildFallbackReason(leversFromOverrides(), 0).length,
    ).toBeGreaterThan(0);
    // Bonus-driven danger edge: no active levers but a danger score.
    expect(
      buildFallbackReason(leversFromOverrides(), 75).length,
    ).toBeGreaterThan(0);
  });
});

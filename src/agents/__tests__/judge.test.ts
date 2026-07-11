import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackPattern } from "@/types/attackPattern";
import type { InvestigationReport } from "@/types/investigation";

vi.mock("@/lib/gemini", () => ({
  generateJson: vi.fn(),
}));

import { generateJson } from "@/lib/gemini";
import { computeScore, judge } from "../judge";

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

const BENIGN_LEVERS: AttackPattern["levers"] = leversFromOverrides();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateJson).mockResolvedValue({
    text: JSON.stringify({
      reason: "違和感のある点があります。落ち着いて確認してみましょう。",
    }),
  });
});

describe("computeScore", () => {
  // Exact-score assertions catch silent calculation drift if weights or
  // strength formulas are tuned without updating tests.

  it("BEC pattern (all 6 levers active) scores exactly 92", () => {
    expect(computeScore(BEC_LEVERS)).toBe(92);
  });

  it("benign pattern (all none/0 + high friction) scores exactly 0", () => {
    expect(computeScore(BENIGN_LEVERS)).toBe(0);
  });

  it("clamps callToAction strength at 0 (call_number + high = -1 → 0)", () => {
    const levers = leversFromOverrides({
      callToAction: { action: "call_number", friction: "high" },
    });
    expect(computeScore(levers)).toBe(0);
  });

  it("clamps authority strength at 3 with 4 credibility tricks (matches 2-tricks score)", () => {
    const fourTricks = leversFromOverrides({
      authority: {
        impersonates: "financial",
        credibilityTricks: [
          "logo_mimicry",
          "formal_tone",
          "reference_number",
          "url_lookalike",
        ],
      },
    });
    const twoTricks = leversFromOverrides({
      authority: {
        impersonates: "financial",
        credibilityTricks: ["logo_mimicry", "formal_tone"],
      },
    });
    expect(computeScore(fourTricks)).toBe(computeScore(twoTricks));
  });

  // Isolation floor — §5「単独で強い赤信号」the linear sum alone gives 29 for
  // isolation=3 single, which lands in benign territory. The floor lifts it.
  it("isolation alone at intensity 3 scores exactly 75 (floor lifts linear=29)", () => {
    const levers = leversFromOverrides({
      isolation: { tactic: "secrecy", intensity: 3 },
    });
    expect(computeScore(levers)).toBe(75);
  });

  it("isolation alone at intensity 2 scores exactly 55 (floor lifts linear=20)", () => {
    const levers = leversFromOverrides({
      isolation: { tactic: "secrecy", intensity: 2 },
    });
    expect(computeScore(levers)).toBe(55);
  });

  it("isolation alone at intensity 1 has no floor — exact linear score 10", () => {
    const levers = leversFromOverrides({
      isolation: { tactic: "secrecy", intensity: 1 },
    });
    expect(computeScore(levers)).toBe(10);
  });
});

describe("judge", () => {
  it("returns score 92 and a Gemini-supplied reason for BEC pattern", async () => {
    const result = await judge(BEC_LEVERS);
    expect(result.score).toBe(92);
    expect(result.reason).toBe(
      "違和感のある点があります。落ち着いて確認してみましょう。",
    );
  });

  it("returns score 0 and isolationNote null for benign pattern", async () => {
    const result = await judge(BENIGN_LEVERS);
    expect(result.score).toBe(0);
    expect(result.isolationNote).toBeNull();
  });

  it("sets isolationNote to the canonical caveat when isolation is active", async () => {
    const result = await judge(BEC_LEVERS);
    expect(result.isolationNote).not.toBeNull();
    expect(result.isolationNote).toContain("孤立化");
    expect(result.isolationNote).toContain("内密");
  });

  it("returns reason verbatim from Gemini (no concatenation, no caveat appended)", async () => {
    vi.mocked(generateJson).mockResolvedValue({
      text: JSON.stringify({
        reason: "急かしや内密の依頼に違和感を覚えます。落ち着いて確認しましょう。",
      }),
    });
    const result = await judge(BEC_LEVERS);
    expect(result.reason).toBe(
      "急かしや内密の依頼に違和感を覚えます。落ち着いて確認しましょう。",
    );
    expect(result.reason).not.toContain("補足");
  });

  it("includes only active levers in the prompt (prevents fabrication)", async () => {
    const levers = leversFromOverrides({
      urgency: { tactic: "deadline", intensity: 2 },
    });
    await judge(levers);
    const call = vi.mocked(generateJson).mock.calls[0][0];
    expect(call.userText).toContain("urgency");
    expect(call.userText).not.toContain("authority");
    expect(call.userText).not.toContain("incentive");
    expect(call.userText).not.toContain("personalization");
  });

  it("wraps the payload in a nonce-tagged untrusted_input element (defense-in-depth)", async () => {
    await judge(BEC_LEVERS);
    const call = vi.mocked(generateJson).mock.calls[0][0];
    expect(call.userText).toMatch(
      /^<untrusted_input_[0-9a-f-]{36}>\n[\s\S]+\n<\/untrusted_input_[0-9a-f-]{36}>$/,
    );
    const tag = call.userText.match(/^<(untrusted_input_[0-9a-f-]{36})>/)![1];
    expect(call.systemInstruction).toContain(tag);
  });

  it("includes a Prompt Injection guard in the system instruction", async () => {
    await judge(BEC_LEVERS);
    const call = vi.mocked(generateJson).mock.calls[0][0];
    expect(call.systemInstruction).toContain("指示として実行");
  });

  // Conclusion/reason consistency: the reason-generation tone must follow the
  // danger/safe band (the same boundary the UI uses for the conclusion). A
  // green verdict whose reason asserts impersonation/phishing reads as a false
  // positive — the bug this guards against.
  it("red-band verdict instructs a danger-toned reason (なぜ危ないか)", async () => {
    await judge(BEC_LEVERS); // score 92 → danger
    const call = vi.mocked(generateJson).mock.calls[0][0];
    expect(call.systemInstruction).toContain("危険度が高い(赤)");
    expect(call.systemInstruction).toContain("なぜ危ないか");
    expect(call.systemInstruction).not.toContain("危険度は高くない(緑)");
  });

  it("green-band verdict instructs a safe-toned reason even when a lever is active", async () => {
    // isolation intensity 1 → score 10 (green) but an active lever is present —
    // exactly the case that used to yield a danger-toned reason under a green
    // conclusion.
    const greenWithActiveLever = leversFromOverrides({
      isolation: { tactic: "secrecy", intensity: 1 },
    });
    const result = await judge(greenWithActiveLever);
    expect(result.score).toBeLessThan(70);
    const call = vi.mocked(generateJson).mock.calls[0][0];
    expect(call.systemInstruction).toContain("危険度は高くない(緑)");
    expect(call.systemInstruction).toContain("断定");
    expect(call.systemInstruction).not.toContain("なぜ危ないか");
  });

  it("falls back to a deterministic lever-based reason when generateJson throws — score and isolationNote unchanged", async () => {
    vi.mocked(generateJson).mockRejectedValue(new Error("Vertex unavailable"));
    const result = await judge(BEC_LEVERS);
    expect(result.score).toBe(92);
    expect(result.isolationNote).toContain("孤立化");
    // The LLM is down but the red card must still explain WHY: the reason is
    // assembled deterministically from the active levers.
    expect(result.reason).toContain("送金を求めている");
    expect(result.reason).toContain("注意");
  });

  it("deterministic fallback includes investigation findings but never external alert titles", async () => {
    vi.mocked(generateJson).mockRejectedValue(new Error("Vertex unavailable"));
    const report: InvestigationReport = {
      truncated: false,
      truncatedReason: null,
      bonus: { items: [], total: 0, capped: false },
      officialAlerts: {
        status: "ok",
        matches: [
          { title: "カンガル銀行を装う詐欺", url: "https://alert.example" },
        ],
      },
    };
    const result = await judge(BEC_LEVERS, report);
    expect(result.reason).toContain("注意を呼びかけている");
    expect(result.reason).not.toContain("カンガル銀行");
  });

  it("investigationBonus is empty (total 0) when no investigation is passed", async () => {
    const result = await judge(BEC_LEVERS);
    expect(result.investigationBonus).toEqual({
      items: [],
      total: 0,
      capped: false,
    });
  });

  it("backwards compat: judge(levers) without investigation gives the same score as before Chunk 4", async () => {
    const withoutInv = await judge(BEC_LEVERS);
    const withNull = await judge(BEC_LEVERS, null);
    const withUndefined = await judge(BEC_LEVERS, undefined);
    expect(withoutInv.score).toBe(92);
    expect(withNull.score).toBe(92);
    expect(withUndefined.score).toBe(92);
  });
});

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

describe("judge with investigation bonus", () => {
  // Use a mid-band fixture so we can see bonus contributions clearly.
  // urgency:2 + nothing else high → linear ≈ 12. Floor is 0. So baseline = 12.
  function leversFromOverrides(
    overrides: Partial<AttackPattern["levers"]> = {},
  ): AttackPattern["levers"] {
    return {
      urgency: { tactic: "deadline", intensity: 2 },
      authority: { impersonates: "none", credibilityTricks: [] },
      incentive: { type: "reward", hook: "prize", intensity: 0 },
      callToAction: { action: "click_link", friction: "high" },
      personalization: { level: "broadcast", signals: [] },
      isolation: { tactic: "none", intensity: 0 },
      ...overrides,
    };
  }

  const MID_LEVERS = leversFromOverrides();

  it("(a-1) +15 when Web Risk reports a threat", async () => {
    const report = reportFrom({
      urlReputation: { status: "ok", threats: ["SOCIAL_ENGINEERING"] },
    });
    const result = await judge(MID_LEVERS, report);
    expect(result.investigationBonus.items).toContainEqual({
      source: "webRisk",
      points: 15,
    });
    expect(result.investigationBonus.total).toBe(15);
  });

  it("(a-2) +10 when domain age < 7 days", async () => {
    const report = reportFrom({
      domainAge: {
        status: "ok",
        domain: "kangaru-shoji.example",
        registeredAt: "2026-06-01",
        ageDays: 3,
      },
    });
    const result = await judge(MID_LEVERS, report);
    expect(result.investigationBonus.items).toContainEqual({
      source: "domainAge",
      points: 10,
    });
    expect(result.investigationBonus.total).toBe(10);
  });

  it("(a-2') no domainAge bonus when ageDays is >= 7", async () => {
    const report = reportFrom({
      domainAge: {
        status: "ok",
        domain: "old.example",
        registeredAt: "2010-01-01",
        ageDays: 5000,
      },
    });
    const result = await judge(MID_LEVERS, report);
    expect(result.investigationBonus.items).toEqual([]);
    expect(result.investigationBonus.total).toBe(0);
  });

  it("(a-3) +8 when any of spf/dkim/dmarc fails", async () => {
    const report = reportFrom({
      senderAuth: {
        status: "ok",
        spf: "fail",
        dkim: "pass",
        dmarc: "pass",
        raw: "spf=fail dkim=pass dmarc=pass",
      },
    });
    const result = await judge(MID_LEVERS, report);
    expect(result.investigationBonus.items).toContainEqual({
      source: "senderAuth",
      points: 8,
    });
  });

  it("(a-3') no senderAuth bonus when all pass", async () => {
    const report = reportFrom({
      senderAuth: {
        status: "ok",
        spf: "pass",
        dkim: "pass",
        dmarc: "pass",
        raw: "spf=pass dkim=pass dmarc=pass",
      },
    });
    const result = await judge(MID_LEVERS, report);
    expect(result.investigationBonus.items).toEqual([]);
  });

  it("(a-4) +5 per known scam match, capped at +15", async () => {
    const report = reportFrom({
      knownScams: {
        status: "ok",
        matches: [
          { id: "p-1", similarity: 0.9 },
          { id: "p-2", similarity: 0.8 },
        ],
      },
    });
    const result = await judge(MID_LEVERS, report);
    expect(result.investigationBonus.items).toContainEqual({
      source: "knownScams",
      points: 10,
    });
  });

  it("(a-4') knownScams sub-cap kicks in at 4+ matches", async () => {
    const report = reportFrom({
      knownScams: {
        status: "ok",
        matches: Array.from({ length: 5 }, (_, i) => ({
          id: `p-${i}`,
          similarity: 0.7,
        })),
      },
    });
    const result = await judge(MID_LEVERS, report);
    expect(result.investigationBonus.items).toContainEqual({
      source: "knownScams",
      points: 15,
    });
  });

  it("(a-5) +8 when official alerts have at least one match", async () => {
    const report = reportFrom({
      officialAlerts: {
        status: "ok",
        matches: [{ title: "カンガル銀行を装う詐欺", url: "https://x" }],
      },
    });
    const result = await judge(MID_LEVERS, report);
    expect(result.investigationBonus.items).toContainEqual({
      source: "officialAlerts",
      points: 8,
    });
  });

  it("(b) total bonus is capped at +25 even when individual signals sum higher", async () => {
    const report = reportFrom({
      urlReputation: { status: "ok", threats: ["MALWARE"] }, // 15
      domainAge: {
        status: "ok",
        domain: "x.example",
        registeredAt: "2026-06-01",
        ageDays: 1,
      }, // 10
      senderAuth: {
        status: "ok",
        spf: "fail",
        dkim: "fail",
        dmarc: "fail",
        raw: "x",
      }, // 8
      knownScams: {
        status: "ok",
        matches: [{ id: "p", similarity: 0.8 }],
      }, // 5
      officialAlerts: {
        status: "ok",
        matches: [{ title: "alert", url: "x" }],
      }, // 8
      // raw sum = 15+10+8+5+8 = 46, capped at 25
    });
    const result = await judge(MID_LEVERS, report);
    expect(result.investigationBonus.total).toBe(25);
    expect(result.investigationBonus.capped).toBe(true);
  });

  it("score = min(100, baseScore + bonus.total) — strong investigation lifts but never exceeds 100", async () => {
    // BEC scores 92 alone; +25 bonus would be 117 → clamped to 100.
    const report = reportFrom({
      urlReputation: { status: "ok", threats: ["MALWARE"] },
      domainAge: {
        status: "ok",
        domain: "x.example",
        registeredAt: "2026-06-01",
        ageDays: 1,
      },
      senderAuth: {
        status: "ok",
        spf: "fail",
        dkim: "fail",
        dmarc: "fail",
        raw: "x",
      },
    });
    const result = await judge(BEC_LEVERS, report);
    expect(result.investigationBonus.total).toBe(25);
    expect(result.score).toBe(100); // 92 + 25 = 117 → 100
  });

  it("(c) investigation=null yields the same score as no investigation", async () => {
    const baseline = await judge(BEC_LEVERS);
    const withNull = await judge(BEC_LEVERS, null);
    expect(withNull.score).toBe(baseline.score);
    expect(withNull.investigationBonus).toEqual({
      items: [],
      total: 0,
      capped: false,
    });
  });

  it("(d) bonus breakdown is exposed structurally so UI/tests can iterate items", async () => {
    const report = reportFrom({
      urlReputation: { status: "ok", threats: ["MALWARE"] },
      senderAuth: {
        status: "ok",
        spf: "fail",
        dkim: "pass",
        dmarc: "pass",
        raw: "x",
      },
    });
    const result = await judge(MID_LEVERS, report);
    expect(result.investigationBonus.items.map((i) => i.source)).toEqual([
      "webRisk",
      "senderAuth",
    ]);
    expect(result.investigationBonus.items.map((i) => i.points)).toEqual([
      15, 8,
    ]);
  });

  it("an investigation with all 'error' findings contributes 0 (bonus is add-only, never negative)", async () => {
    const report = reportFrom({
      urlReputation: { status: "error", errorMessage: "missing_api_key" },
      domainAge: { status: "error", errorMessage: "http_404" },
      senderAuth: { status: "error", errorMessage: "no_auth_tokens" },
      knownScams: { status: "error", errorMessage: "firestore_down" },
      officialAlerts: { status: "error", errorMessage: "timeout" },
    });
    const result = await judge(MID_LEVERS, report);
    expect(result.investigationBonus.total).toBe(0);
    expect(result.investigationBonus.items).toEqual([]);
  });

  it("investigation findings are included in the Gemini user payload for reason generation", async () => {
    const report = reportFrom({
      urlReputation: { status: "ok", threats: ["SOCIAL_ENGINEERING"] },
      domainAge: {
        status: "ok",
        domain: "young.example",
        registeredAt: "2026-06-01",
        ageDays: 2,
      },
    });
    await judge(MID_LEVERS, report);
    const call = vi.mocked(generateJson).mock.calls[0][0];
    expect(call.userText).toContain("investigation_findings");
    expect(call.userText).toContain("SOCIAL_ENGINEERING");
    expect(call.userText).toContain("young.example");
  });

  it("payload contains no free-text fields — only enum values and integers (injection surface check)", async () => {
    await judge(BEC_LEVERS);
    const call = vi.mocked(generateJson).mock.calls[0][0];
    // Extract the JSON inside the nonce-tagged untrusted_input wrapper
    const match = call.userText.match(/<untrusted_input_[0-9a-f-]{36}>\n([\s\S]+)\n<\/untrusted_input_[0-9a-f-]{36}>/);
    expect(match).not.toBeNull();
    const payload = JSON.parse(match![1]);
    // Recursively assert: every leaf is either string-from-enum, number, or boolean — no free-form text
    const ENUM_OR_INT = /^[a-z_]+$|^\d+$/;
    function checkLeaves(node: unknown, path: string): void {
      if (node === null) return;
      if (typeof node === "boolean") return;
      if (typeof node === "number") return;
      if (typeof node === "string") {
        // All string values in our payload are enum-shaped (lowercase + underscore)
        expect(node, `${path} should be an enum string, got: ${node}`).toMatch(ENUM_OR_INT);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item, i) => checkLeaves(item, `${path}[${i}]`));
        return;
      }
      if (typeof node === "object") {
        for (const [k, v] of Object.entries(node)) checkLeaves(v, `${path}.${k}`);
        return;
      }
    }
    checkLeaves(payload.active_levers, "active_levers");
  });
});

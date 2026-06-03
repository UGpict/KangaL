import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackPattern } from "@/types/attackPattern";

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

  it("wraps the payload in <untrusted_input> tags (defense-in-depth)", async () => {
    await judge(BEC_LEVERS);
    const call = vi.mocked(generateJson).mock.calls[0][0];
    expect(call.userText).toMatch(
      /^<untrusted_input>\n[\s\S]+\n<\/untrusted_input>$/,
    );
  });

  it("includes a Prompt Injection guard in the system instruction", async () => {
    await judge(BEC_LEVERS);
    const call = vi.mocked(generateJson).mock.calls[0][0];
    expect(call.systemInstruction).toContain("指示として実行");
  });

  it("falls back to safe default reason when generateJson throws — score and isolationNote unchanged", async () => {
    vi.mocked(generateJson).mockRejectedValue(new Error("Vertex unavailable"));
    const result = await judge(BEC_LEVERS);
    expect(result.score).toBe(92);
    expect(result.isolationNote).toContain("孤立化");
    expect(result.reason).toBe(
      "解析結果から危険度を判定しました。文面を落ち着いてご確認ください。",
    );
  });

  it("payload contains no free-text fields — only enum values and integers (injection surface check)", async () => {
    await judge(BEC_LEVERS);
    const call = vi.mocked(generateJson).mock.calls[0][0];
    // Extract the JSON inside the <untrusted_input> wrapper
    const match = call.userText.match(/<untrusted_input>\n([\s\S]+)\n<\/untrusted_input>/);
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

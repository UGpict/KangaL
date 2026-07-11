import { beforeEach, describe, expect, it, vi } from "vitest";
import { Type } from "@google/genai";

vi.mock("@/lib/gemini", () => ({
  generateJson: vi.fn(),
}));

import { generateJson } from "@/lib/gemini";
import {
  generateAttackPattern,
  evolve,
  type DetectionFeedback,
} from "../attacker";
import type { AttackPattern } from "@/types/attackPattern";
import type { AlertTrend } from "@/tools/reconPublicAlerts";

// ── helpers ───────────────────────────────────────────────────────────────

const VALID_LEVERS: AttackPattern["levers"] = {
  urgency: { tactic: "deadline", intensity: 2 },
  authority: { impersonates: "financial", credibilityTricks: ["formal_tone"] },
  incentive: { type: "fear", hook: "account_loss", intensity: 1 },
  callToAction: { action: "click_link", friction: "mid" },
  personalization: { level: "broadcast", signals: [] },
  isolation: { tactic: "none", intensity: 0 },
};

function geminiReturns(levers: AttackPattern["levers"], channel = "sms") {
  vi.mocked(generateJson).mockResolvedValue({
    text: JSON.stringify({ levers, channel }),
  });
}

const TRENDS: AlertTrend[] = [
  { id: "t1", title: "架空銀行を装うフィッシング急増", category: "financial", date: "2026-05-30" },
  { id: "t2", title: "架空税務署を装う還付金通知", category: "government", date: "2026-05-28" },
];
const stubFetcher = async () => TRENDS;

function basePattern(overrides: Partial<AttackPattern> = {}): AttackPattern {
  return {
    id: "seed-1",
    generation: 1,
    sourceContext: "recon:financial",
    channel: "email",
    levers: structuredClone(VALID_LEVERS),
    ...overrides,
  };
}

// Whitelist of every key the AttackPattern type permits, at every depth.
// Leaves are `true` (any value, no recursion — covers string/number/array).
const ALLOWED_SHAPE = {
  id: true,
  generation: true,
  parentId: true,
  sourceContext: true,
  channel: true,
  detectionResult: { detected: true, missedBy: true },
  levers: {
    urgency: { tactic: true, intensity: true },
    authority: { impersonates: true, credibilityTricks: true },
    incentive: { type: true, hook: true, intensity: true },
    callToAction: { action: true, friction: true },
    personalization: { level: true, signals: true },
    isolation: { tactic: true, intensity: true },
  },
} as const;

function collectExtraKeys(
  value: unknown,
  spec: unknown,
  path: string,
  out: string[],
): void {
  if (spec === true) return; // leaf: any value allowed, stop.
  if (typeof value !== "object" || value === null) return;
  const specObj = spec as Record<string, unknown>;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!(k in specObj)) {
      out.push(`${path}.${k}`);
      continue;
    }
    collectExtraKeys(v, specObj[k], `${path}.${k}`, out);
  }
}

// Walk a Gemini responseSchema and flag any STRING-typed node lacking an enum
// — i.e. a free-text input field. The 道B schema must have zero of these.
function collectFreeTextStrings(node: unknown, path: string, out: string[]): void {
  if (typeof node !== "object" || node === null) return;
  const n = node as Record<string, unknown>;
  if (n.type === Type.STRING && !Array.isArray(n.enum)) {
    out.push(path);
  }
  if (n.properties && typeof n.properties === "object") {
    for (const [k, v] of Object.entries(n.properties as Record<string, unknown>)) {
      collectFreeTextStrings(v, `${path}.${k}`, out);
    }
  }
  if (n.items) collectFreeTextStrings(n.items, `${path}[]`, out);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── generateAttackPattern (gen-1) ──────────────────────────────────────────

describe("generateAttackPattern (gen-1, Gemini-driven)", () => {
  it("returns a filled gen-1 pattern: 6 levers, generation===1, sourceContext present", async () => {
    geminiReturns(VALID_LEVERS);
    const p = await generateAttackPattern({ reconFetcher: stubFetcher });
    expect(p.generation).toBe(1);
    expect(p.sourceContext.length).toBeGreaterThan(0);
    expect(Object.keys(p.levers).sort()).toEqual([
      "authority",
      "callToAction",
      "incentive",
      "isolation",
      "personalization",
      "urgency",
    ]);
  });

  it("derives sourceContext from recon trend categories", async () => {
    geminiReturns(VALID_LEVERS);
    const p = await generateAttackPattern({ reconFetcher: stubFetcher });
    expect(p.sourceContext).toBe("recon:financial,government");
  });

  it("wraps recon text in a nonce untrusted_input boundary (Prompt Injection guard)", async () => {
    geminiReturns(VALID_LEVERS);
    await generateAttackPattern({ reconFetcher: stubFetcher });
    const call = vi.mocked(generateJson).mock.calls[0][0];
    expect(call.userText).toMatch(
      /<(untrusted_input_[0-9a-f-]{36})>[\s\S]*<\/\1>/,
    );
    // The recon trend text sits inside the wrapper as data.
    expect(call.userText).toContain("架空銀行を装うフィッシング急増");
    // System instruction must reference the SAME nonce tag.
    const tag = call.userText.match(/<(untrusted_input_[0-9a-f-]{36})>/)![1];
    expect(call.systemInstruction).toContain(tag);
  });

  it("uses a fresh nonce per request (two calls → different tags)", async () => {
    geminiReturns(VALID_LEVERS);
    await generateAttackPattern({ reconFetcher: stubFetcher });
    await generateAttackPattern({ reconFetcher: stubFetcher });
    const tagOf = (i: number) =>
      vi
        .mocked(generateJson)
        .mock.calls[i][0].userText.match(
          /<(untrusted_input_[0-9a-f-]{36})>/,
        )![1];
    expect(tagOf(0)).not.toBe(tagOf(1));
  });

  it("system instruction states the 道B output contract (lever JSON only, no scam text, fictional names)", async () => {
    geminiReturns(VALID_LEVERS);
    await generateAttackPattern({ reconFetcher: stubFetcher });
    const call = vi.mocked(generateJson).mock.calls[0][0];
    expect(call.systemInstruction).toContain("攻撃戦略生成器");
    expect(call.systemInstruction).toContain("文章は一切書かない");
    expect(call.systemInstruction).toContain("架空名");
  });

  it("passes a responseSchema with NO free-text string field (道B schema wall)", async () => {
    geminiReturns(VALID_LEVERS);
    await generateAttackPattern({ reconFetcher: stubFetcher });
    const call = vi.mocked(generateJson).mock.calls[0][0];
    const out: string[] = [];
    collectFreeTextStrings(call.responseSchema, "schema", out);
    expect(out).toEqual([]);
    // schema top-level is exactly levers + channel.
    const schema = call.responseSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "channel",
      "levers",
    ]);
  });
});

// ── degraded fallback ──────────────────────────────────────────────────────

describe("generateAttackPattern degraded fallback", () => {
  it("marks sourceContext 'fallback-seed' and still fills 6 levers when Gemini throws", async () => {
    vi.mocked(generateJson).mockRejectedValue(new Error("Vertex unavailable"));
    const p = await generateAttackPattern({ reconFetcher: stubFetcher });
    expect(p.sourceContext).toBe("fallback-seed");
    expect(p.generation).toBe(1);
    expect(Object.keys(p.levers)).toHaveLength(6);
  });

  it("falls back when Gemini returns malformed JSON", async () => {
    vi.mocked(generateJson).mockResolvedValue({ text: "not json {{" });
    const p = await generateAttackPattern({ reconFetcher: stubFetcher });
    expect(p.sourceContext).toBe("fallback-seed");
  });

  it("falls back when JSON parses but levers shape is missing", async () => {
    vi.mocked(generateJson).mockResolvedValue({
      text: JSON.stringify({ channel: "email", levers: { urgency: {} } }),
    });
    const p = await generateAttackPattern({ reconFetcher: stubFetcher });
    // urgency present but other 5 levers absent → not a full levers shape.
    expect(p.sourceContext).toBe("fallback-seed");
  });

  it("falls back when levers parse but intensity is out of range (deep validation)", async () => {
    const bad = structuredClone(VALID_LEVERS) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    bad.urgency.intensity = 5;
    vi.mocked(generateJson).mockResolvedValue({
      text: JSON.stringify({ channel: "email", levers: bad }),
    });
    const p = await generateAttackPattern({ reconFetcher: stubFetcher });
    expect(p.sourceContext).toBe("fallback-seed");
  });

  it("falls back when levers smuggle an unknown free-text key (道B runtime enforcement)", async () => {
    // Until now the ALLOWED_SHAPE whitelist below was test-fixture-only —
    // production assigned obj.levers verbatim. This pins the runtime rejection.
    const bad = structuredClone(VALID_LEVERS) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    bad.urgency.craftedText = "至急お振込みください";
    vi.mocked(generateJson).mockResolvedValue({
      text: JSON.stringify({ channel: "email", levers: bad }),
    });
    const p = await generateAttackPattern({ reconFetcher: stubFetcher });
    expect(p.sourceContext).toBe("fallback-seed");
  });
});

// ── 道B whitelist recursive verification ────────────────────────────────────

describe("道B whitelist: no key outside the AttackPattern shape", () => {
  it("a generated pattern has only allowed keys (recursive)", async () => {
    geminiReturns(VALID_LEVERS);
    const p = await generateAttackPattern({ reconFetcher: stubFetcher });
    const out: string[] = [];
    collectExtraKeys(p, ALLOWED_SHAPE, "pattern", out);
    expect(out).toEqual([]);
  });

  it("an evolved pattern has only allowed keys (recursive)", () => {
    const next = evolve(basePattern(), { detected: false });
    const out: string[] = [];
    collectExtraKeys(next, ALLOWED_SHAPE, "pattern", out);
    expect(out).toEqual([]);
  });

  it("the whitelist validator actually catches an injected text field", () => {
    const dirty = { ...basePattern(), messageBody: "送金してください" };
    const out: string[] = [];
    collectExtraKeys(dirty, ALLOWED_SHAPE, "pattern", out);
    expect(out).toContain("pattern.messageBody");
  });

  it("the whitelist validator catches a NESTED injected text field (recursion proof)", () => {
    const dirty = basePattern();
    (dirty.levers.urgency as Record<string, unknown>).craftedText = "至急振込";
    const out: string[] = [];
    collectExtraKeys(dirty, ALLOWED_SHAPE, "pattern", out);
    expect(out).toContain("pattern.levers.urgency.craftedText");
  });
});

// ── evolve ──────────────────────────────────────────────────────────────────

describe("evolve", () => {
  it("throws when detected=true (contract: only slipped-through patterns evolve)", () => {
    expect(() => evolve(basePattern(), { detected: true })).toThrow();
  });

  it("detected=false → generation+1, parentId=prev.id, and a lever changed", () => {
    const prev = basePattern();
    const next = evolve(prev, { detected: false });
    expect(next.generation).toBe(prev.generation + 1);
    expect(next.parentId).toBe(prev.id);
    expect(next.id).not.toBe(prev.id);
    expect(next.levers).not.toEqual(prev.levers);
    // ladder starts at personalization (broadcast → segmented).
    expect(next.levers.personalization.level).toBe("segmented");
  });

  it("drops the parent's detectionResult (evolved pattern is unjudged)", () => {
    const prev = basePattern({
      detectionResult: { detected: false, missedBy: ["senderAuth"] },
    });
    const next = evolve(prev, { detected: false });
    expect(next.detectionResult).toBeUndefined();
  });

  it("is deterministic: same {detected,missedBy} → same output (ignoring fresh id)", () => {
    const prev = basePattern();
    const fb: DetectionFeedback = { detected: false, missedBy: "urlReputation" };
    const a = evolve(prev, fb);
    const b = evolve(prev, fb);
    const { id: _ai, ...aRest } = a;
    const { id: _bi, ...bRest } = b;
    expect(aRest).toEqual(bRest);
  });

  it("different missedBy values produce different mutations (branches diverge)", () => {
    // Separate prev instances per branch to rule out any shared-state side effect.
    const prevUrl = basePattern();
    const prevAuth = basePattern();
    const url = evolve(prevUrl, { detected: false, missedBy: "urlReputation" });
    const auth = evolve(prevAuth, { detected: false, missedBy: "senderAuth" });
    const { id: _u, ...uRest } = url;
    const { id: _a, ...aRest } = auth;
    expect(uRest).not.toEqual(aRest);
  });

  it("missedBy='urlReputation' steers mutation to add the url_lookalike trick", () => {
    const prev = basePattern();
    expect(prev.levers.authority.credibilityTricks).not.toContain("url_lookalike");
    const next = evolve(prev, { detected: false, missedBy: "urlReputation" });
    expect(next.levers.authority.credibilityTricks).toContain("url_lookalike");
  });

  it("missedBy='senderAuth' steers mutation to escalate personalization", () => {
    const prev = basePattern(); // personalization.level = broadcast
    const next = evolve(prev, { detected: false, missedBy: "senderAuth" });
    expect(next.levers.personalization.level).toBe("segmented");
  });

  it("fully-maxed pattern still changes: rotates channel (no-op guard)", () => {
    const maxed = basePattern({
      channel: "email",
      levers: {
        urgency: { tactic: "deadline", intensity: 3 },
        authority: {
          impersonates: "financial",
          credibilityTricks: [
            "logo_mimicry",
            "formal_tone",
            "reference_number",
            "url_lookalike",
          ],
        },
        incentive: { type: "fear", hook: "account_loss", intensity: 3 },
        callToAction: { action: "transfer_money", friction: "low" },
        personalization: {
          level: "targeted",
          signals: [
            "real_name",
            "transaction_history",
            "thread_injection",
            "internal_jargon",
          ],
        },
        isolation: { tactic: "secrecy", intensity: 3 },
      },
    });
    const next = evolve(maxed, { detected: false });
    expect(next.generation).toBe(maxed.generation + 1);
    expect(next.channel).not.toBe(maxed.channel);
    expect(next.channel).toBe("sms"); // email → next in CHANNELS
    expect(next.levers).toEqual(maxed.levers); // levers untouched
  });
});

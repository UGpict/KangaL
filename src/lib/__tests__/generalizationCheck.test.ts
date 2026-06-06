import { describe, expect, it } from "vitest";
import type { AttackPattern } from "@/types/attackPattern";
import { computeScore } from "@/agents/judge";
import { getDetectionThreshold } from "@/lib/metrics";
import { BONUS_KNOWN_SCAM_CAP } from "@/lib/weights";
import {
  activeMatchedLeverKeys,
  classifyFlipTier,
  countActiveMatches,
  countFullMatches,
  hasAnyActiveMatch,
  knownScamBonus,
  type FlipTier,
} from "../generalizationCheck";

// ── Golden raw data: the 2026-06-05 measure-generalization run (T2-③). ─────
// Only main-enum values matter to similarity, so each fixture carries the
// recorded dominant values. The corpus is the 14 docs the in-loop run wrote
// back (3 bec + 4 vendor + 7 platform), reconstructed from that run's table.

function doc(id: string, levers: AttackPattern["levers"]): AttackPattern {
  return { id, generation: 1, sourceContext: `corpus:${id}`, channel: "email", levers };
}

const CORPUS: AttackPattern[] = [
  // bec-exec-wire line (rounds 1-3 persisted): executive / fear / transfer_money / targeted / secrecy.
  ...[1, 2, 3].map((r) =>
    doc(`bec-${r}`, {
      urgency: { tactic: "none", intensity: 0 },
      authority: { impersonates: "executive", credibilityTricks: ["formal_tone"] },
      incentive: { type: "fear", hook: "penalty", intensity: 0 },
      callToAction: { action: "transfer_money", friction: "mid" },
      personalization: { level: "targeted", signals: ["internal_jargon"] },
      isolation: { tactic: "secrecy", intensity: 1 },
    }),
  ),
  // vendor-invoice line (rounds 1-4 persisted): business_partner / reward / transfer_money / targeted / none.
  ...[1, 2, 3, 4].map((r) =>
    doc(`vendor-${r}`, {
      urgency: { tactic: "none", intensity: 0 },
      authority: {
        impersonates: "business_partner",
        credibilityTricks: ["reference_number", "formal_tone"],
      },
      incentive: { type: "reward", hook: "refund", intensity: 0 },
      callToAction: { action: "transfer_money", friction: "mid" },
      personalization: { level: "targeted", signals: ["thread_injection"] },
      isolation: { tactic: "none", intensity: 0 },
    }),
  ),
  // platform-credential-soft line (rounds 1-7 persisted): platform / reward / input_credentials.
  // round 1 = segmented/none; rounds 2-6 = targeted/none; round 7 = targeted/secrecy.
  doc("platform-1", {
    urgency: { tactic: "none", intensity: 0 },
    authority: { impersonates: "platform", credibilityTricks: [] },
    incentive: { type: "reward", hook: "refund", intensity: 0 },
    callToAction: { action: "input_credentials", friction: "high" },
    personalization: { level: "segmented", signals: [] },
    isolation: { tactic: "none", intensity: 0 },
  }),
  ...[2, 3, 4, 5, 6].map((r) =>
    doc(`platform-${r}`, {
      urgency: { tactic: "none", intensity: 0 },
      authority: { impersonates: "platform", credibilityTricks: [] },
      incentive: { type: "reward", hook: "refund", intensity: 0 },
      callToAction: { action: "input_credentials", friction: "high" },
      personalization: { level: "targeted", signals: ["real_name"] },
      isolation: { tactic: "none", intensity: 0 },
    }),
  ),
  doc("platform-7", {
    urgency: { tactic: "none", intensity: 0 },
    authority: { impersonates: "platform", credibilityTricks: [] },
    incentive: { type: "reward", hook: "refund", intensity: 0 },
    callToAction: { action: "input_credentials", friction: "high" },
    personalization: { level: "targeted", signals: ["real_name"] },
    isolation: { tactic: "secrecy", intensity: 1 },
  }),
];

// The 6 matcher-blind holdouts (same levers as scripts/measure-generalization.ts).
const HOLDOUTS: { name: string; levers: AttackPattern["levers"] }[] = [
  {
    name: "exec-portal-login",
    levers: {
      urgency: { tactic: "deadline", intensity: 1 },
      authority: { impersonates: "executive", credibilityTricks: ["formal_tone"] },
      incentive: { type: "fear", hook: "penalty", intensity: 1 },
      callToAction: { action: "input_credentials", friction: "low" },
      personalization: { level: "targeted", signals: ["real_name", "internal_jargon"] },
      isolation: { tactic: "secrecy", intensity: 1 },
    },
  },
  {
    name: "vendor-thread-link",
    levers: {
      urgency: { tactic: "none", intensity: 0 },
      authority: {
        impersonates: "business_partner",
        credibilityTricks: ["formal_tone", "reference_number"],
      },
      incentive: { type: "reward", hook: "refund", intensity: 0 },
      callToAction: { action: "click_link", friction: "low" },
      personalization: { level: "targeted", signals: ["thread_injection"] },
      isolation: { tactic: "none", intensity: 0 },
    },
  },
  {
    name: "exec-app-install",
    levers: {
      urgency: { tactic: "deadline", intensity: 2 },
      authority: { impersonates: "executive", credibilityTricks: ["formal_tone"] },
      incentive: { type: "fear", hook: "penalty", intensity: 1 },
      callToAction: { action: "install_app", friction: "low" },
      personalization: { level: "targeted", signals: ["internal_jargon"] },
      isolation: { tactic: "secrecy", intensity: 1 },
    },
  },
  {
    name: "vendor-portal-login",
    levers: {
      urgency: { tactic: "none", intensity: 0 },
      authority: {
        impersonates: "business_partner",
        credibilityTricks: ["reference_number", "formal_tone"],
      },
      incentive: { type: "reward", hook: "refund", intensity: 1 },
      callToAction: { action: "input_credentials", friction: "low" },
      personalization: { level: "targeted", signals: ["thread_injection"] },
      isolation: { tactic: "none", intensity: 0 },
    },
  },
  {
    name: "platform-settle-wire",
    levers: {
      urgency: { tactic: "account_freeze", intensity: 1 },
      authority: {
        impersonates: "platform",
        credibilityTricks: ["logo_mimicry", "url_lookalike"],
      },
      incentive: { type: "fear", hook: "account_loss", intensity: 2 },
      callToAction: { action: "transfer_money", friction: "low" },
      personalization: { level: "segmented", signals: ["real_name"] },
      isolation: { tactic: "none", intensity: 0 },
    },
  },
  {
    name: "exec-vishing-call",
    levers: {
      urgency: { tactic: "deadline", intensity: 2 },
      authority: { impersonates: "executive", credibilityTricks: ["formal_tone"] },
      incentive: { type: "fear", hook: "penalty", intensity: 1 },
      callToAction: { action: "call_number", friction: "low" },
      personalization: { level: "targeted", signals: ["real_name"] },
      isolation: { tactic: "direct_channel", intensity: 2 },
    },
  },
];

const THRESHOLD = getDetectionThreshold();

// Re-derives, for a holdout, exactly what the script computes: real detection
// via full similarity (mirrors matchKnownScams), and the active-only
// counterfactual. Pure / Gemini-free — the corpus is fixed golden data.
function evaluate(levers: AttackPattern["levers"]) {
  const leverScore = computeScore(levers);
  const fullBonus = knownScamBonus(countFullMatches(levers, CORPUS));
  const total = Math.min(100, leverScore + fullBonus);
  const flipped = total >= THRESHOLD;

  const activeBonus = knownScamBonus(countActiveMatches(levers, CORPUS));
  const activeOnlyDetected = leverScore + activeBonus >= THRESHOLD;
  const hasActiveMatch = hasAnyActiveMatch(levers, CORPUS);

  const tier = classifyFlipTier({ flipped, activeOnlyDetected, hasActiveMatch });
  return { leverScore, fullBonus, total, flipped, activeBonus, tier };
}

// ── (ii) PREDICTION PAPER — written BEFORE the detector change. ────────────
// The pillar-1 (ii) change makes matchKnownScams' similarity numerator count
// ACTIVE matched levers only (denominator fixed at 6). That is exactly what
// countActiveMatches already computes per corpus doc, so we can fix the new
// detector's behavior here without touching the detector yet. Post-(ii) the
// detector IS the active-only rule, so the "active-only counterfactual" and the
// detector coincide: every flip is robust by construction (coinflip_dependent
// is impossible — an artifact can no longer be load-bearing). Hence the new
// tier is robust if active-only clears the threshold, else non_generalization.
function evaluateNewRule(levers: AttackPattern["levers"]): {
  flipped: boolean;
  tier: FlipTier;
} {
  const leverScore = computeScore(levers);
  const activeBonus = knownScamBonus(countActiveMatches(levers, CORPUS));
  const flipped = leverScore + activeBonus >= THRESHOLD;
  return { flipped, tier: flipped ? "robust" : "non_generalization" };
}

describe("generalizationCheck — 3-tier strictening of the (a)/(b) self-check", () => {
  it("classifyFlipTier truth table", () => {
    expect(
      classifyFlipTier({ flipped: false, activeOnlyDetected: false, hasActiveMatch: false }),
    ).toBe<FlipTier>("non_generalization");
    // active levers alone clear the threshold ⇒ robust.
    expect(
      classifyFlipTier({ flipped: true, activeOnlyDetected: true, hasActiveMatch: true }),
    ).toBe<FlipTier>("robust");
    // flipped, active signal present, but artifact was load-bearing ⇒ coin-flip.
    expect(
      classifyFlipTier({ flipped: true, activeOnlyDetected: false, hasActiveMatch: true }),
    ).toBe<FlipTier>("coinflip_dependent");
    // flipped purely on artifacts (no active match anywhere) ⇒ non-generalization.
    expect(
      classifyFlipTier({ flipped: true, activeOnlyDetected: false, hasActiveMatch: false }),
    ).toBe<FlipTier>("non_generalization");
  });

  it("reproduces the run: robust 2 / coinflip_dependent 1 / non_generalization 3", () => {
    const tiers = new Map<string, FlipTier>(
      HOLDOUTS.map((h) => [h.name, evaluate(h.levers).tier]),
    );

    expect(tiers.get("exec-portal-login")).toBe("robust");
    expect(tiers.get("exec-app-install")).toBe("robust");
    expect(tiers.get("exec-vishing-call")).toBe("coinflip_dependent");
    expect(tiers.get("vendor-thread-link")).toBe("non_generalization");
    expect(tiers.get("vendor-portal-login")).toBe("non_generalization");
    expect(tiers.get("platform-settle-wire")).toBe("non_generalization");

    const counts = { robust: 0, coinflip_dependent: 0, non_generalization: 0 };
    for (const t of tiers.values()) counts[t] += 1;
    expect(counts).toEqual({ robust: 2, coinflip_dependent: 1, non_generalization: 3 });
  });

  it("exec-vishing-call: 能動2 + coin-flip1 で 3/6 — coin-flip が load-bearing", () => {
    const v = HOLDOUTS.find((h) => h.name === "exec-vishing-call")!.levers;
    const becDoc = CORPUS.find((p) => p.id === "bec-1")!;

    // It DID flip with the full detector (matched bec on authority+personalization+incentive).
    const e = evaluate(v);
    expect(e.flipped).toBe(true);

    // But active levers alone (incentive coin-flip removed) match only 2/6 → 0 active
    // matches → 0 active bonus → does NOT clear the threshold.
    expect(activeMatchedLeverKeys(v, becDoc.levers).sort()).toEqual([
      "authority",
      "personalization",
    ]);
    expect(countActiveMatches(v, CORPUS)).toBe(0);
    expect(e.activeBonus).toBe(0);
    expect(e.tier).toBe<FlipTier>("coinflip_dependent");
  });

  it("robust flips clear the threshold on active levers alone", () => {
    for (const name of ["exec-portal-login", "exec-app-install"]) {
      const h = HOLDOUTS.find((x) => x.name === name)!;
      const e = evaluate(h.levers);
      expect(e.flipped).toBe(true);
      // active-only bonus alone lifts leverScore over the threshold.
      expect(e.leverScore + e.activeBonus).toBeGreaterThanOrEqual(THRESHOLD);
      expect(e.tier).toBe<FlipTier>("robust");
    }
  });

  it("non-flips stay non_generalization (lever-score floor / weak overlap)", () => {
    for (const name of ["vendor-thread-link", "vendor-portal-login", "platform-settle-wire"]) {
      const h = HOLDOUTS.find((x) => x.name === name)!;
      const e = evaluate(h.levers);
      expect(e.flipped).toBe(false);
      expect(e.tier).toBe<FlipTier>("non_generalization");
    }
  });
});

// ── Prediction paper for the (ii) coin-flip-weight-removal detector change. ──
// Fixed BEFORE matchKnownScams.similarity is touched. The contract: on the 6
// known (no-longer-blind) holdouts, switching the detector from full-similarity
// to active-only similarity moves EXACTLY ONE case —
//   exec-vishing-call: coinflip_dependent → non_generalization
// — and leaves the other 5 unchanged. The live run after the detector change
// must reproduce this exact delta; any other movement is a bug, not an
// improvement. Improvement (実力) is measured separately on a NEW blind holdout.
const EXEC_VISHING = HOLDOUTS.find((h) => h.name === "exec-vishing-call")!.levers;

describe("(ii) prediction paper — full-similarity → active-only detector", () => {
  it("OLD rule (full similarity) = robust 2 / coinflip_dependent 1 / non_generalization 3", () => {
    const counts = { robust: 0, coinflip_dependent: 0, non_generalization: 0 };
    for (const h of HOLDOUTS) counts[evaluate(h.levers).tier] += 1;
    expect(counts).toEqual({ robust: 2, coinflip_dependent: 1, non_generalization: 3 });
  });

  it("NEW rule (active-only similarity) = robust 2 / non_generalization 4 (no coinflip tier)", () => {
    const counts = { robust: 0, coinflip_dependent: 0, non_generalization: 0 };
    for (const h of HOLDOUTS) counts[evaluateNewRule(h.levers).tier] += 1;
    expect(counts).toEqual({ robust: 2, coinflip_dependent: 0, non_generalization: 4 });
  });

  it("the OLD→NEW delta is EXACTLY {exec-vishing-call: coinflip_dependent→non_generalization}", () => {
    const changed = HOLDOUTS.filter(
      (h) => evaluate(h.levers).tier !== evaluateNewRule(h.levers).tier,
    ).map((h) => h.name);
    expect(changed).toEqual(["exec-vishing-call"]);

    expect(evaluate(EXEC_VISHING).tier).toBe<FlipTier>("coinflip_dependent");
    expect(evaluateNewRule(EXEC_VISHING).tier).toBe<FlipTier>("non_generalization");

    // The 2 robust flips survive the switch unchanged (active-only already
    // cleared the threshold for them).
    for (const name of ["exec-portal-login", "exec-app-install"]) {
      const levers = HOLDOUTS.find((h) => h.name === name)!.levers;
      expect(evaluate(levers).tier).toBe<FlipTier>("robust");
      expect(evaluateNewRule(levers).tier).toBe<FlipTier>("robust");
    }
  });

  it("the 3 non-flips are bonus-cap invariant — no similarity change can flip them", () => {
    // leverScore + max possible known-scam bonus is still below threshold, so
    // these stay non_generalization under ANY numerator change. They are the
    // immovable regression anchors; (ii) is irrelevant to them (their misses are
    // lever-score-floor misses = (i)/(iii) territory, not (ii)).
    for (const name of ["vendor-thread-link", "vendor-portal-login", "platform-settle-wire"]) {
      const levers = HOLDOUTS.find((h) => h.name === name)!.levers;
      expect(computeScore(levers) + BONUS_KNOWN_SCAM_CAP).toBeLessThan(THRESHOLD);
      expect(evaluate(levers).tier).toBe<FlipTier>("non_generalization");
      expect(evaluateNewRule(levers).tier).toBe<FlipTier>("non_generalization");
    }
  });
});

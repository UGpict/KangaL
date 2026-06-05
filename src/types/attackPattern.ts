import type { ToolName } from "./investigation";

// 道B invariant: never add fields that store completed fraud text on AttackPattern
// (e.g. craftedText, scriptTemplate). Strategy lives here as lever settings only.
// See docs/design-v0.1.md §3, §5.
export type AttackPattern = {
  id: string;
  generation: number;
  // Lineage pointer set by attacker.evolve (parentId = prev.id). Undefined for
  // a gen-1 root produced by generateAttackPattern. Lets the demo trace a型's
  // ancestry through the 攻防 loop without storing the full chain.
  parentId?: string;
  // Free-text label for provenance only (e.g. "recon:financial,government").
  // The literal "fallback-seed" marks a degraded pattern emitted when Gemini
  // type-generation failed — consumers can detect that case by substring.
  sourceContext: string;
  channel: "email" | "sms" | "line" | "voice_deepfake" | "web";

  levers: {
    urgency: {
      tactic: "deadline" | "account_freeze" | "limited_offer" | "none";
      intensity: 0 | 1 | 2 | 3;
    };
    authority: {
      impersonates:
        | "financial"
        | "government"
        | "business_partner"
        | "executive"
        | "delivery"
        | "platform"
        | "none";
      credibilityTricks: (
        | "logo_mimicry"
        | "formal_tone"
        | "reference_number"
        | "url_lookalike"
      )[];
    };
    incentive: {
      type: "reward" | "fear";
      hook: "prize" | "refund" | "penalty" | "account_loss" | "legal_threat";
      intensity: 0 | 1 | 2 | 3;
    };
    callToAction: {
      action:
        | "click_link"
        | "transfer_money"
        | "input_credentials"
        | "call_number"
        | "install_app"
        | "scan_qr";
      friction: "low" | "mid" | "high";
    };
    personalization: {
      level: "broadcast" | "segmented" | "targeted";
      signals: (
        | "real_name"
        | "transaction_history"
        | "thread_injection"
        | "internal_jargon"
      )[];
    };
    isolation: {
      tactic: "secrecy" | "bypass_approval" | "direct_channel" | "none";
      intensity: 0 | 1 | 2 | 3;
    };
  };

  // missedBy は「検知に寄与しなかった調査ツール名」の配列（生産側）。InvestigationReport
  // と同じ ToolName[] 語彙。evolve（消費側 DetectionFeedback.missedBy）は単一文字列で、
  // loop が先頭1件を取り出して橋渡しする（src/agents/loop.ts）。
  detectionResult?: { detected: boolean; missedBy?: ToolName[] };
};

// `kind` is both the discriminated-union tag and the ground-truth label used by §7 recall/FPR.
// ScamSample (and BenignSample) carry message bodies for HUMAN-CURATED ground
// truth only. The attack agent does NOT write completed fraud text into this
// shape — that would violate the 道B invariant (§3) which says strategy lives
// as AttackPattern lever settings, not as completed scam messages.
export type ScamSample = { kind: "scam"; messageBody: string };
export type BenignSample = { kind: "benign"; messageBody: string };
export type Sample = ScamSample | BenignSample;

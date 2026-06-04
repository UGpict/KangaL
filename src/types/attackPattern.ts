// 道B invariant: never add fields that store completed fraud text on AttackPattern
// (e.g. craftedText, scriptTemplate). Strategy lives here as lever settings only.
// See docs/design-v0.1.md §3, §5.
export type AttackPattern = {
  id: string;
  generation: number;
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

  detectionResult?: { detected: boolean; missedBy?: string };
};

// `kind` is both the discriminated-union tag and the ground-truth label used by §7 recall/FPR.
// ScamSample (and BenignSample) carry message bodies for HUMAN-CURATED ground
// truth only. The attack agent does NOT write completed fraud text into this
// shape — that would violate the 道B invariant (§3) which says strategy lives
// as AttackPattern lever settings, not as completed scam messages.
export type ScamSample = { kind: "scam"; messageBody: string };
export type BenignSample = { kind: "benign"; messageBody: string };
export type Sample = ScamSample | BenignSample;

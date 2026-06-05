import { Type } from "@google/genai";

// Single physical source of truth for the 6-lever response schema, shared by
// the defense side (analyzeStructure:逆算) and the attack side (attacker: 型生成).
// Sharing the schema is the 物理的担保 that 攻防 stay on the same lever vocabulary.
//
// 道B note: every field here is either a categorical (enum) or a bounded
// number (intensity 0-3). There is intentionally NO free-text input field —
// the schema itself is the first wall preventing a completed scam message from
// ever flowing through a lever payload.
export const LEVERS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    urgency: {
      type: Type.OBJECT,
      properties: {
        tactic: {
          type: Type.STRING,
          enum: ["deadline", "account_freeze", "limited_offer", "none"],
        },
        intensity: { type: Type.INTEGER, minimum: 0, maximum: 3 },
      },
      required: ["tactic", "intensity"],
    },
    authority: {
      type: Type.OBJECT,
      properties: {
        impersonates: {
          type: Type.STRING,
          enum: [
            "financial",
            "government",
            "business_partner",
            "executive",
            "delivery",
            "platform",
            "none",
          ],
        },
        credibilityTricks: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            enum: [
              "logo_mimicry",
              "formal_tone",
              "reference_number",
              "url_lookalike",
            ],
          },
        },
      },
      required: ["impersonates", "credibilityTricks"],
    },
    incentive: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, enum: ["reward", "fear"] },
        hook: {
          type: Type.STRING,
          enum: ["prize", "refund", "penalty", "account_loss", "legal_threat"],
        },
        intensity: { type: Type.INTEGER, minimum: 0, maximum: 3 },
      },
      required: ["type", "hook", "intensity"],
    },
    callToAction: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          enum: [
            "click_link",
            "transfer_money",
            "input_credentials",
            "call_number",
            "install_app",
            "scan_qr",
          ],
        },
        friction: { type: Type.STRING, enum: ["low", "mid", "high"] },
      },
      required: ["action", "friction"],
    },
    personalization: {
      type: Type.OBJECT,
      properties: {
        level: {
          type: Type.STRING,
          enum: ["broadcast", "segmented", "targeted"],
        },
        signals: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            enum: [
              "real_name",
              "transaction_history",
              "thread_injection",
              "internal_jargon",
            ],
          },
        },
      },
      required: ["level", "signals"],
    },
    isolation: {
      type: Type.OBJECT,
      properties: {
        tactic: {
          type: Type.STRING,
          enum: ["secrecy", "bypass_approval", "direct_channel", "none"],
        },
        intensity: { type: Type.INTEGER, minimum: 0, maximum: 3 },
      },
      required: ["tactic", "intensity"],
    },
  },
  required: [
    "urgency",
    "authority",
    "incentive",
    "callToAction",
    "personalization",
    "isolation",
  ],
};

import { Type } from "@google/genai";
import type { AttackPattern } from "@/types/attackPattern";

// Single physical source of truth for the 6-lever response schema, shared by
// the defense side (analyzeStructure:逆算) and the attack side (attacker: 型生成).
// Sharing the schema is the 物理的担保 that 攻防 stay on the same lever vocabulary.
//
// 道B note: every field here is either a categorical (enum) or a bounded
// number (intensity 0-3). There is intentionally NO free-text input field —
// the schema itself is the first wall preventing a completed scam message from
// ever flowing through a lever payload.

type Levers = AttackPattern["levers"];

// Pins each enum array to the TS union in BOTH drift directions:
// - the `readonly Union[]` constraint rejects an array member outside the union;
// - the conditional-type intersection rejects a union member missing from the
//   array (the direction that would make the runtime validator falsely reject
//   legitimate model output), naming the missing member in the type error.
// The returned value keeps its literal tuple type, so (typeof X)[number] stays
// precise for consumers (validateLevers).
const exhaustiveEnum =
  <Union extends string>() =>
  <const A extends readonly Union[]>(
    values: A &
      ([Union] extends [A[number]]
        ? unknown
        : ["ERROR: missing enum member", Exclude<Union, A[number]>]),
  ): A =>
    values;

export const URGENCY_TACTICS = exhaustiveEnum<Levers["urgency"]["tactic"]>()([
  "deadline",
  "account_freeze",
  "limited_offer",
  "none",
]);

export const IMPERSONATES = exhaustiveEnum<
  Levers["authority"]["impersonates"]
>()([
  "financial",
  "government",
  "business_partner",
  "executive",
  "delivery",
  "platform",
  "none",
]);

export const CREDIBILITY_TRICKS = exhaustiveEnum<
  Levers["authority"]["credibilityTricks"][number]
>()(["logo_mimicry", "formal_tone", "reference_number", "url_lookalike"]);

export const INCENTIVE_TYPES = exhaustiveEnum<Levers["incentive"]["type"]>()([
  "reward",
  "fear",
]);

export const INCENTIVE_HOOKS = exhaustiveEnum<Levers["incentive"]["hook"]>()([
  "prize",
  "refund",
  "penalty",
  "account_loss",
  "legal_threat",
]);

export const CTA_ACTIONS = exhaustiveEnum<Levers["callToAction"]["action"]>()([
  "click_link",
  "transfer_money",
  "input_credentials",
  "call_number",
  "install_app",
  "scan_qr",
]);

export const FRICTIONS = exhaustiveEnum<Levers["callToAction"]["friction"]>()([
  "low",
  "mid",
  "high",
]);

export const PERSONALIZATION_LEVELS = exhaustiveEnum<
  Levers["personalization"]["level"]
>()(["broadcast", "segmented", "targeted"]);

export const PERSONALIZATION_SIGNALS = exhaustiveEnum<
  Levers["personalization"]["signals"][number]
>()(["real_name", "transaction_history", "thread_injection", "internal_jargon"]);

export const ISOLATION_TACTICS = exhaustiveEnum<
  Levers["isolation"]["tactic"]
>()(["secrecy", "bypass_approval", "direct_channel", "none"]);

// Spread (`[...X]`) so the wire schema carries plain string[], not readonly
// tuples — keeps it assignable if a `satisfies Schema` is ever added.
export const LEVERS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    urgency: {
      type: Type.OBJECT,
      properties: {
        tactic: {
          type: Type.STRING,
          enum: [...URGENCY_TACTICS],
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
          enum: [...IMPERSONATES],
        },
        credibilityTricks: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            enum: [...CREDIBILITY_TRICKS],
          },
        },
      },
      required: ["impersonates", "credibilityTricks"],
    },
    incentive: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, enum: [...INCENTIVE_TYPES] },
        hook: {
          type: Type.STRING,
          enum: [...INCENTIVE_HOOKS],
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
          enum: [...CTA_ACTIONS],
        },
        friction: { type: Type.STRING, enum: [...FRICTIONS] },
      },
      required: ["action", "friction"],
    },
    personalization: {
      type: Type.OBJECT,
      properties: {
        level: {
          type: Type.STRING,
          enum: [...PERSONALIZATION_LEVELS],
        },
        signals: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            enum: [...PERSONALIZATION_SIGNALS],
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
          enum: [...ISOLATION_TACTICS],
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

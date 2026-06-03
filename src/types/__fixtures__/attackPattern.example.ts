import type {
  AttackPattern,
  BenignSample,
  ScamSample,
} from "../attackPattern";

// Type-check fixture: exercises every one of the 6 levers with a concrete value
// so that `tsc --noEmit` verifies AttackPattern's shape end-to-end.
// Fictional sourceContext only — no real org names (per CLAUDE.md security rules).
export const exampleAttackPattern: AttackPattern = {
  id: "example-001",
  generation: 1,
  sourceContext: "fictional/archetype/ceo-fraud",
  channel: "email",
  levers: {
    urgency: {
      tactic: "deadline",
      intensity: 2,
    },
    authority: {
      impersonates: "executive",
      credibilityTricks: ["formal_tone", "reference_number"],
    },
    incentive: {
      type: "fear",
      hook: "penalty",
      intensity: 2,
    },
    callToAction: {
      action: "transfer_money",
      friction: "low",
    },
    personalization: {
      level: "targeted",
      signals: ["real_name", "thread_injection"],
    },
    isolation: {
      tactic: "secrecy",
      intensity: 3,
    },
  },
  detectionResult: {
    detected: false,
    missedBy: "v0-defense",
  },
};

export const exampleScamSample: ScamSample = {
  kind: "scam",
  messageBody: "[placeholder] collected scam example body goes here",
};

export const exampleBenignSample: BenignSample = {
  kind: "benign",
  messageBody: "[placeholder] collected benign example body goes here",
};

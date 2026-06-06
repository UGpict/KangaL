import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSet, mockDoc, mockCollection } = vi.hoisted(() => {
  const set = vi.fn().mockResolvedValue(undefined);
  const doc = vi.fn(() => ({ set }));
  const collection = vi.fn(() => ({ doc }));
  return { mockSet: set, mockDoc: doc, mockCollection: collection };
});

vi.mock("@google-cloud/firestore", () => ({
  Firestore: class MockFirestore {
    collection = mockCollection;
  },
}));

import { __resetForTests, upsertAttackPattern } from "../corpusWriter";
import { ATTACK_PATTERN_COLLECTION } from "../firestore";

beforeEach(() => {
  vi.clearAllMocks();
  __resetForTests();
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
});

describe("corpusWriter (道B writer 隔離モジュール)", () => {
  it("upsertAttackPattern writes the AttackPattern schema to attackPatterns/{id}", async () => {
    const levers = {
      urgency: { tactic: "none", intensity: 0 },
      authority: { impersonates: "executive", credibilityTricks: ["formal_tone"] },
      incentive: { type: "fear", hook: "penalty", intensity: 0 },
      callToAction: { action: "transfer_money", friction: "mid" },
      personalization: { level: "targeted", signals: ["internal_jargon"] },
      isolation: { tactic: "secrecy", intensity: 1 },
    };
    await upsertAttackPattern({
      id: "pat-123",
      generation: 2,
      parentId: "pat-122",
      sourceContext: "diagnostic-seed:bec",
      channel: "email",
      // detectionResult はコーパス素性に不要 → 保存されないことを確認する。
      detectionResult: { detected: false },
      levers,
    } as never);
    expect(mockCollection).toHaveBeenCalledWith(ATTACK_PATTERN_COLLECTION);
    expect(mockDoc).toHaveBeenCalledWith("pat-123");
    // 道B: levers + channel + 系譜のみ。id はフィールドに含めず、detectionResult は落とす。
    expect(mockSet).toHaveBeenCalledWith({
      generation: 2,
      sourceContext: "diagnostic-seed:bec",
      channel: "email",
      parentId: "pat-122",
      levers,
    });
  });

  it("upsertAttackPattern omits parentId when absent (gen-1 root)", async () => {
    const levers = {
      urgency: { tactic: "none", intensity: 0 },
      authority: { impersonates: "none", credibilityTricks: [] },
      incentive: { type: "reward", hook: "refund", intensity: 0 },
      callToAction: { action: "click_link", friction: "high" },
      personalization: { level: "broadcast", signals: [] },
      isolation: { tactic: "none", intensity: 0 },
    };
    await upsertAttackPattern({
      id: "pat-root",
      generation: 1,
      sourceContext: "seed",
      channel: "sms",
      levers,
    } as never);
    expect(mockSet).toHaveBeenCalledWith({
      generation: 1,
      sourceContext: "seed",
      channel: "sms",
      levers,
    });
  });
});

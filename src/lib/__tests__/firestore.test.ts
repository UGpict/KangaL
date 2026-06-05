import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSet, mockGet, mockDoc, mockCollection } = vi.hoisted(() => {
  const set = vi.fn().mockResolvedValue(undefined);
  const get = vi.fn();
  const doc = vi.fn(() => ({ set }));
  const collection = vi.fn(() => ({ doc, get }));
  return { mockSet: set, mockGet: get, mockDoc: doc, mockCollection: collection };
});

vi.mock("@google-cloud/firestore", () => ({
  // Class form (not vi.fn arrow) — Firestore is invoked with `new`, and an
  // arrow returned from mockImplementation is not a constructor.
  Firestore: class MockFirestore {
    collection = mockCollection;
  },
}));

import {
  __resetForTests,
  BENIGN_COLLECTION,
  listBenignSamples,
  upsertBenignSample,
} from "../firestore";

beforeEach(() => {
  vi.clearAllMocks();
  __resetForTests();
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
});

describe("firestore (smoke)", () => {
  it("upsertBenignSample writes to benignSamples/{id} with kind + messageBody", async () => {
    await upsertBenignSample("ben-001", {
      kind: "benign",
      messageBody: "hello",
    });
    expect(mockCollection).toHaveBeenCalledWith(BENIGN_COLLECTION);
    expect(mockDoc).toHaveBeenCalledWith("ben-001");
    expect(mockSet).toHaveBeenCalledWith({
      kind: "benign",
      messageBody: "hello",
    });
  });

  it("listBenignSamples returns docs with id + kind + messageBody", async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: "ben-001",
          data: () => ({ kind: "benign", messageBody: "hello" }),
        },
        {
          id: "ben-002",
          data: () => ({ kind: "benign", messageBody: "world" }),
        },
      ],
    });
    const result = await listBenignSamples();
    expect(mockCollection).toHaveBeenCalledWith(BENIGN_COLLECTION);
    expect(result).toEqual([
      { id: "ben-001", kind: "benign", messageBody: "hello" },
      { id: "ben-002", kind: "benign", messageBody: "world" },
    ]);
  });

  it("listBenignSamples returns [] for an empty collection", async () => {
    mockGet.mockResolvedValueOnce({ docs: [] });
    expect(await listBenignSamples()).toEqual([]);
  });
});

describe("firestore scam helpers (smoke)", () => {
  it("listScamSamples reads from scamSamples and returns id + kind + body", async () => {
    const { listScamSamples, SCAM_SAMPLE_COLLECTION } = await import(
      "../firestore"
    );
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: "scam-001",
          data: () => ({ kind: "scam", messageBody: "x" }),
        },
      ],
    });
    const result = await listScamSamples();
    expect(mockCollection).toHaveBeenCalledWith(SCAM_SAMPLE_COLLECTION);
    expect(result).toEqual([
      { id: "scam-001", kind: "scam", messageBody: "x" },
    ]);
  });

  it("listAttackPatterns reads from attackPatterns and overrides id from the doc id", async () => {
    const { listAttackPatterns, ATTACK_PATTERN_COLLECTION } = await import(
      "../firestore"
    );
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: "pat-001",
          data: () => ({
            id: "ignored-internal-id",
            generation: 1,
            sourceContext: "fictional",
            channel: "email",
            levers: {},
          }),
        },
      ],
    });
    const result = await listAttackPatterns();
    expect(mockCollection).toHaveBeenCalledWith(ATTACK_PATTERN_COLLECTION);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("pat-001");
    expect(result[0].generation).toBe(1);
  });

  it("listAttackPatterns returns [] for an empty collection", async () => {
    const { listAttackPatterns } = await import("../firestore");
    mockGet.mockResolvedValueOnce({ docs: [] });
    expect(await listAttackPatterns()).toEqual([]);
  });

  it("upsertAttackPattern writes the AttackPattern schema to attackPatterns/{id}", async () => {
    const { upsertAttackPattern, ATTACK_PATTERN_COLLECTION } = await import(
      "../firestore"
    );
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
    const { upsertAttackPattern } = await import("../firestore");
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

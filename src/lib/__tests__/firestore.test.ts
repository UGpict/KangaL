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

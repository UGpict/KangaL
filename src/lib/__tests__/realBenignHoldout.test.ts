import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSet, mockGet, mockDoc, mockCollection } = vi.hoisted(() => {
  const set = vi.fn().mockResolvedValue(undefined);
  const get = vi.fn();
  const doc = vi.fn(() => ({ set }));
  const collection = vi.fn(() => ({ doc, get }));
  return { mockSet: set, mockGet: get, mockDoc: doc, mockCollection: collection };
});

vi.mock("@google-cloud/firestore", () => ({
  Firestore: class MockFirestore {
    collection = mockCollection;
  },
}));

import {
  __resetForTests,
  REAL_BENIGN_HOLDOUT_COLLECTION,
  listRealBenignHoldout,
  upsertRealBenignSample,
} from "../realBenignHoldout";
import {
  ATTACK_PATTERN_COLLECTION,
  BENIGN_COLLECTION,
  SCAM_SAMPLE_COLLECTION,
} from "../firestore";
import { REAL_SCAM_HOLDOUT_COLLECTION } from "../realScamHoldout";
import { REAL_BENIGN_HOLDOUT } from "@/data/realBenignHoldout";

beforeEach(() => {
  vi.clearAllMocks();
  __resetForTests();
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
});

describe("realBenignHoldout (評価専用・物理分離)", () => {
  it("コレクション名は攻撃コーパス/良性/scamSamples/realScamHoldout のいずれとも別", () => {
    expect(REAL_BENIGN_HOLDOUT_COLLECTION).toBe("realBenignHoldout");
    for (const other of [
      ATTACK_PATTERN_COLLECTION,
      BENIGN_COLLECTION,
      SCAM_SAMPLE_COLLECTION,
      REAL_SCAM_HOLDOUT_COLLECTION,
    ]) {
      expect(REAL_BENIGN_HOLDOUT_COLLECTION).not.toBe(other);
    }
  });

  it("upsertRealBenignSample は realBenignHoldout/{id} へ kind+body+difficulty+provenance を書く", async () => {
    await upsertRealBenignSample("real-b-001", {
      kind: "benign",
      messageBody: "本文",
      benignDifficulty: "easy",
      provenance: { source: "e-Tax", collectedAt: "2026-06-06" },
    });
    expect(mockCollection).toHaveBeenCalledWith(REAL_BENIGN_HOLDOUT_COLLECTION);
    expect(mockDoc).toHaveBeenCalledWith("real-b-001");
    expect(mockSet).toHaveBeenCalledWith({
      kind: "benign",
      messageBody: "本文",
      benignDifficulty: "easy",
      provenance: { source: "e-Tax", collectedAt: "2026-06-06" },
    });
  });

  it("listRealBenignHoldout は id+kind+body+difficulty+provenance を返し、欠損を埋める", async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: "real-b-001",
          data: () => ({
            kind: "benign",
            messageBody: "x",
            benignDifficulty: "effective",
            provenance: {
              source: "実受信",
              collectedAt: "2026-06-06",
              reference: "https://example.org/a",
            },
          }),
        },
        {
          // benignDifficulty 欠損 → easy に正規化（最も楽観側へ寄せる）。
          id: "real-b-002",
          data: () => ({ kind: "benign", messageBody: "y" }),
        },
      ],
    });
    const result = await listRealBenignHoldout();
    expect(mockCollection).toHaveBeenCalledWith(REAL_BENIGN_HOLDOUT_COLLECTION);
    expect(result).toEqual([
      {
        id: "real-b-001",
        kind: "benign",
        messageBody: "x",
        benignDifficulty: "effective",
        provenance: {
          source: "実受信",
          collectedAt: "2026-06-06",
          reference: "https://example.org/a",
        },
      },
      {
        id: "real-b-002",
        kind: "benign",
        messageBody: "y",
        benignDifficulty: "easy",
        provenance: { source: "", collectedAt: "" },
      },
    ]);
  });

  it("listRealBenignHoldout は空コレクションで [] を返す", async () => {
    mockGet.mockResolvedValueOnce({ docs: [] });
    expect(await listRealBenignHoldout()).toEqual([]);
  });
});

describe("REAL_BENIGN_HOLDOUT データファイル（投入元）", () => {
  it("全エントリが id・difficulty・provenance(source, collectedAt) を持つ", () => {
    for (const s of REAL_BENIGN_HOLDOUT) {
      expect(s.id).toBeTruthy();
      expect(s.kind).toBe("benign");
      expect(typeof s.messageBody).toBe("string");
      expect(s.messageBody.trim()).toBeTruthy(); // 空 body 投入を禁止
      expect(["easy", "effective"]).toContain(s.benignDifficulty);
      expect(s.provenance?.source?.trim()).toBeTruthy();
      expect(s.provenance?.collectedAt?.trim()).toBeTruthy();
    }
  });

  it("id は一意（重複投入の防止）", () => {
    const ids = REAL_BENIGN_HOLDOUT.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

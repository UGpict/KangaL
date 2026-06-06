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
  REAL_SCAM_HOLDOUT_COLLECTION,
  listRealScamHoldout,
  upsertRealScamSample,
} from "../realScamHoldout";
import {
  ATTACK_PATTERN_COLLECTION,
  BENIGN_COLLECTION,
  SCAM_SAMPLE_COLLECTION,
} from "../firestore";
import { REAL_SCAM_HOLDOUT } from "@/data/realScamHoldout";

beforeEach(() => {
  vi.clearAllMocks();
  __resetForTests();
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
});

describe("realScamHoldout (評価専用・物理分離)", () => {
  it("コレクション名は攻撃コーパス/良性/scamSamples のいずれとも別（物理分離）", () => {
    expect(REAL_SCAM_HOLDOUT_COLLECTION).toBe("realScamHoldout");
    for (const other of [
      ATTACK_PATTERN_COLLECTION,
      BENIGN_COLLECTION,
      SCAM_SAMPLE_COLLECTION,
    ]) {
      expect(REAL_SCAM_HOLDOUT_COLLECTION).not.toBe(other);
    }
  });

  it("upsertRealScamSample は realScamHoldout/{id} へ kind+body+provenance を書く", async () => {
    await upsertRealScamSample("real-001", {
      kind: "scam",
      messageBody: "本文",
      provenance: { source: "IPA", collectedAt: "2026-06-06" },
    });
    expect(mockCollection).toHaveBeenCalledWith(REAL_SCAM_HOLDOUT_COLLECTION);
    expect(mockDoc).toHaveBeenCalledWith("real-001");
    expect(mockSet).toHaveBeenCalledWith({
      kind: "scam",
      messageBody: "本文",
      provenance: { source: "IPA", collectedAt: "2026-06-06" },
    });
  });

  it("listRealScamHoldout は id+kind+body+provenance を返し、欠損 provenance を空文字で埋める", async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: "real-001",
          data: () => ({
            kind: "scam",
            messageBody: "x",
            provenance: {
              source: "JPCERT/CC",
              collectedAt: "2026-06-01",
              reference: "https://example.org/a",
            },
          }),
        },
        {
          id: "real-002",
          data: () => ({ kind: "scam", messageBody: "y" }),
        },
      ],
    });
    const result = await listRealScamHoldout();
    expect(mockCollection).toHaveBeenCalledWith(REAL_SCAM_HOLDOUT_COLLECTION);
    expect(result).toEqual([
      {
        id: "real-001",
        kind: "scam",
        messageBody: "x",
        provenance: {
          source: "JPCERT/CC",
          collectedAt: "2026-06-01",
          reference: "https://example.org/a",
        },
      },
      {
        id: "real-002",
        kind: "scam",
        messageBody: "y",
        provenance: { source: "", collectedAt: "" },
      },
    ]);
  });

  it("listRealScamHoldout は空コレクションで [] を返す", async () => {
    mockGet.mockResolvedValueOnce({ docs: [] });
    expect(await listRealScamHoldout()).toEqual([]);
  });
});

describe("REAL_SCAM_HOLDOUT データファイル（投入元）", () => {
  it("全エントリが id と provenance(source, collectedAt) を持つ（捏造・出自不明の混入防止）", () => {
    // 現状は空で正しい（実物未投入）。空でも将来追加分を守るため形状を固定する。
    for (const s of REAL_SCAM_HOLDOUT) {
      expect(s.id).toBeTruthy();
      expect(s.kind).toBe("scam");
      expect(typeof s.messageBody).toBe("string");
      expect(s.provenance?.source?.trim()).toBeTruthy();
      expect(s.provenance?.collectedAt?.trim()).toBeTruthy();
    }
  });

  it("id は一意（重複投入の防止）", () => {
    const ids = REAL_SCAM_HOLDOUT.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

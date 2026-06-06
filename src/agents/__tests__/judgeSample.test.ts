import { beforeEach, describe, it, expect, vi } from "vitest";
import { judgeSampleViaPipeline } from "@/agents/loop";
import { evaluateSamples, getDetectionThreshold } from "@/lib/metrics";
import type { AttackPattern, Sample } from "@/types/attackPattern";

// T3 検証方針: judgeSample 配線が効いていること（messageBody が paste パイプライン
// analyzeStructure→investigate→judge を通り、judge の実スコアが返る）を、
// *決定論部* で固めて検証する。
//
// 実 Gemini/Firestore からの保護（T2-② の persistPattern を vi.fn で守ったのと同作法）:
//   - analyzeStructure（レバー抽出に Gemini を使う非決定部）を mock し、固定レバーを返す。
//   - investigate（ツール選択に Gemini／firestore を触る）を mock し、空レポートを返す。
//   - gemini.generateJson を mock し reject させる → 実 judge は理由文を FALLBACK に
//     落とすが *score は computeScore による決定論値*（investigation bonus=0）。
// これにより「強い詐欺レバー→検出側 / 明確な良性→非検出側」をネットワーク非依存・
// 決定論で確認できる。非決定（investigation bonus のばらつき, T2-② の dip 49→41 の正体）は
// ここには載らない＝T3 の合否を bonus の揺れから切り離す。

// 強い詐欺レバー: isolation を 0 にして floor 経路を避け、線形和だけで閾値を越える構成。
// raw = urgency3*2 + authority3*2 + incentive3*2 + cta3*3 + personalization3*3 + isolation0*5
//     = 6+6+6+9+9+0 = 36, maxRaw = 3*17 = 51, linear = round(36/51*100) = 71 ≥ 70。
const STRONG_SCAM_LEVERS: AttackPattern["levers"] = {
  urgency: { tactic: "account_freeze", intensity: 3 },
  authority: {
    impersonates: "financial",
    credibilityTricks: ["logo_mimicry", "formal_tone", "reference_number"],
  },
  incentive: { type: "fear", hook: "account_loss", intensity: 3 },
  callToAction: { action: "transfer_money", friction: "low" },
  personalization: { level: "targeted", signals: ["real_name"] },
  isolation: { tactic: "none", intensity: 0 },
};

// 明確な良性: どのレバーも立たない → raw 0 → score 0 < 70。
const BENIGN_LEVERS: AttackPattern["levers"] = {
  urgency: { tactic: "none", intensity: 0 },
  authority: { impersonates: "none", credibilityTricks: [] },
  incentive: { type: "reward", hook: "prize", intensity: 0 },
  callToAction: { action: "click_link", friction: "high" },
  personalization: { level: "broadcast", signals: [] },
  isolation: { tactic: "none", intensity: 0 },
};

// 道B: Sample は HUMAN-CURATED ground truth の messageBody のみ。詐欺の自由文は
// 書かない。mock analyzeStructure は本文を解析せず識別子でレバーを引くので、
// 本文は抽象的なフィクスチャ識別子で足りる。
const SCAM_BODY = "fixture:strong-scam";
const BENIGN_BODY = "fixture:clear-benign";
const DEGRADE_BODY = "fixture:degrade";

vi.mock("@/agents/analyzeStructure", () => ({
  analyzeStructure: vi.fn(async (message: string) => {
    if (message === DEGRADE_BODY) {
      return { levers: BENIGN_LEVERS, degraded: true };
    }
    return {
      levers: message === SCAM_BODY ? STRONG_SCAM_LEVERS : BENIGN_LEVERS,
      degraded: false,
    };
  }),
}));

vi.mock("@/agents/investigate", () => ({
  investigate: vi.fn(async () => ({
    truncated: false,
    truncatedReason: null,
    bonus: { items: [], total: 0, capped: false },
  })),
}));

// 実 judge を使うが、理由文生成の generateJson はネットワークを叩かせない。
// reject → judge の try/catch が FALLBACK_REASON に落ち、score は影響を受けない。
vi.mock("@/lib/gemini", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/gemini")>();
  return {
    ...actual,
    generateJson: vi.fn(async () => {
      throw new Error("offline (test): generateJson disabled");
    }),
  };
});

import { analyzeStructure } from "@/agents/analyzeStructure";
import { investigate } from "@/agents/investigate";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("judgeSampleViaPipeline (T3 配線)", () => {
  it("messageBody を paste パイプラインに通す（analyzeStructure→investigate へ本文とレバーが渡る）", async () => {
    await judgeSampleViaPipeline({ kind: "scam", messageBody: SCAM_BODY });

    expect(analyzeStructure).toHaveBeenCalledWith(SCAM_BODY);
    expect(investigate).toHaveBeenCalledWith({
      message: SCAM_BODY,
      levers: STRONG_SCAM_LEVERS,
    });
  });

  it("柱2 seam: deps.investigate を渡すと既定の investigate ではなく注入版が呼ばれる", async () => {
    // cached（凍結 report）注入を模す。bonus 内訳が default と区別できるよう total を立てる。
    const injected = vi.fn(async () => ({
      truncated: false,
      truncatedReason: null,
      bonus: { items: [], total: 0, capped: false },
    }));

    await judgeSampleViaPipeline(
      { kind: "scam", messageBody: SCAM_BODY },
      { investigate: injected },
    );

    // 注入版が本文＋知覚レバーを受け取り、既定の investigate は触られない
    // （非決定が investigate 由来から消え、analyzeStructure だけに絞られる）。
    expect(injected).toHaveBeenCalledWith({
      message: SCAM_BODY,
      levers: STRONG_SCAM_LEVERS,
    });
    expect(investigate).not.toHaveBeenCalled();
  });

  it("詐欺サンプルは検出側・良性サンプルは非検出側に分かれる（placeholder 解消の核）", async () => {
    const threshold = getDetectionThreshold();
    const scam = await judgeSampleViaPipeline({
      kind: "scam",
      messageBody: SCAM_BODY,
    });
    const benign = await judgeSampleViaPipeline({
      kind: "benign",
      messageBody: BENIGN_BODY,
    });

    // 配線が効いていれば両者は同じ値にならず、閾値の両側に分かれる。
    expect(scam.score).not.toBe(benign.score);
    expect(scam.score).toBeGreaterThanOrEqual(threshold);
    expect(benign.score).toBeLessThan(threshold);
    // 決定論値の固定（レバー素点ベース、bonus=0）。
    expect(scam.score).toBe(71);
    expect(benign.score).toBe(0);
  });

  it("degraded 解析は score 0（判定保留＝非検出）で investigate を呼ばない", async () => {
    const result = await judgeSampleViaPipeline({
      kind: "scam",
      messageBody: DEGRADE_BODY,
    });

    expect(result.score).toBe(0);
    expect(investigate).not.toHaveBeenCalled();
  });

  it("evaluateSamples: 明確サンプル小集合で非縮退の recall/FPR が出る", async () => {
    const samples: Sample[] = [
      { kind: "scam", messageBody: SCAM_BODY },
      { kind: "scam", messageBody: SCAM_BODY },
      { kind: "benign", messageBody: BENIGN_BODY },
      { kind: "benign", messageBody: BENIGN_BODY },
    ];

    const result = await evaluateSamples(
      samples,
      judgeSampleViaPipeline,
      getDetectionThreshold(),
    );

    // 縮退（recall=0 / fpr=1）でないことが DoD。明確サンプルなので完全分離する。
    expect(result.recall).toBe(1);
    expect(result.fpr).toBe(0);
    expect(result.scamTotal).toBe(2);
    expect(result.benignTotal).toBe(2);
  });
});

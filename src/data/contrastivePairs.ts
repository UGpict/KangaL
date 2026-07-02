import type { AttackPattern } from "@/types/attackPattern";
import type { SampleProvenance } from "@/types/attackPattern";

type LeverKey = keyof AttackPattern["levers"];

// ── 盲変異 対照ペア（山場＝標的型の "機構" を検証するための合成データ）──────────
//
// なぜ合成か: 本物の標的型/BEC を "集める" のは道B（完全な詐欺文面を保存しない）と
// ゼロ段（ラベル枯渇）の二重の壁にぶつかる。標的型は定義上パーソナライズ済みで、生文面は
// 最も保存してはいけない類。だから "生成する" に切り替える——系統分離を守る盲変異ペアで。
//
// 各ペアの作り方（構成規律）:
//  - base    : effective-benign。正規なのに軽くレバーが立つ本物寄りの文（役員の至急送金
//              依頼、締切付き請求 等）。実在名は架空化（security 規律）。
//  - mutated : base に *自然な一文* で target レバー *1個だけ* を足したもの。逆算の匂いが
//              出ないよう表層は自然に（表層生成のみ攻撃側を借りてよい＝採点・ラベル付けは
//              させない・系統分離）。
//  - targetLever : mutation が動かす唯一のレバー。ラベルはこの "構成事実"。
//
// 検証: scripts/validateContrastivePairs.ts が base/mutated を多数決抽出し「target 指紋
// だけが動き他は不変」を機械確認する（鏡像汚染ガード＝二重ゲートの (i)）。人間が挿入文を
// "自然" と読む (ii) はコード外。
//
// 注意: これは詐欺 "本文" コーパスではない。base は良性・mutated は base+1レバーで、
// どちらも攻撃コーパス(attackPatterns)や holdout とは別物。攻撃側 evolve には渡さない。

export type ContrastivePair = {
  id: string;
  // mutation が動かす唯一のレバー（構成事実＝ラベル）。
  targetLever: LeverKey;
  base: { text: string };
  mutated: { text: string };
  provenance: SampleProvenance;
};

// 空。effective-benign の土台を得たら、上の規律で盲変異ペアを構成して投入し、
// scripts/validateContrastivePairs.ts でガードを通してから採用する。
export const CONTRASTIVE_PAIRS: ContrastivePair[] = [];

import { analyzeStructure } from "@/agents/analyzeStructure";
import { investigate, type InvestigateInput } from "@/agents/investigate";
import { computeScore, judge } from "@/agents/judge";
import type { AttackPattern, Sample } from "@/types/attackPattern";
import type { InvestigationReport } from "@/types/investigation";

// 防御側の *読み取り専用* 判定/評価エントリ（柱2 不変条件A の対象）。
//
// このモジュールは ground-truth Sample（道B: messageBody のみ）を /api/judge と同じ
// paste パイプライン（analyzeStructure → investigate → judge）に通してスコアを返す。
// warm が後で読む attackPatterns コーパスへは *一切書かない*——書けば AFTER warm が
// 漏れたレバーを学習し BEFORE→AFTER の伸びが汎化でなく漏洩になる（corpusWriter.ts の
// 注記参照）。この不変条件は judgeSample.boundary.test.ts が import グラフで静的に守る:
// このファイルの到達集合に corpusWriter（唯一のコーパス writer）が現れたら失敗する。
//
// warm ループ（runLoop, 書き込みあり）は意図的に別モジュール src/agents/loop.ts に
// 置く。両者が同一ファイルに同居すると file 単位の境界テストで読み/書きを分離できない
// ため、能力（read-only eval / write-capable warm）をモジュールで割っている。

// 柱2 二段運用の注入点: investigation 層だけを live/キャッシュで差し替えられる
// ようにする唯一の seam。analyzeStructure（防御の知覚）と judge は固定のまま。
// - live（既定）: deps を省略 → 実 investigate（Web Risk/RDAP 等の関数呼び出し）。
// - cached: 凍結済み InvestigationReport を返す関数を渡す。BEFORE/AFTER 差分主張と
//   本番デモ用。investigate を固定すると run 間の非決定が analyzeStructure 由来だけに
//   絞れる（4分類 attribution の missed-perception が純粋に知覚失敗を指す）。
// 注意（残る穴）: 注入関数の中身は型では縛れない（report を返す任意の関数）。理論上は
// 注入版が corpusWriter を自力 import して書くことが可能で、その経路は import グラフ
// 境界テストの静的スコープ外（テストは既定 investigate の到達集合を歩く）。完全に塞ぐには
// corpus ハンドルを reader 型で引数渡しする thread が要る——現状の侵襲度に見合わないため
// 未実施、と明示する。
export type InvestigateFn = (
  input: InvestigateInput,
) => Promise<InvestigationReport>;

// 柱2 計器（holdoutEval）に渡す判定素材。score だけでなくレバー素点と bonus 内訳
// （known-scam＝self-play corpus 由来 / それ以外＝外部調査）を生点で返す。これにより
// 評価器側が「warm の伸びが corpus 由来か調査由来か」を counterfactual で切り分けられる。
export type SampleJudgeDetail = {
  score: number;
  degraded: boolean;
  perceivedLevers: AttackPattern["levers"] | null;
  leverScore: number;
  knownScamBonusRaw: number;
  otherInvestigationBonusRaw: number;
};

export async function judgeSampleDetailed(
  sample: Sample,
  deps: { investigate?: InvestigateFn } = {},
): Promise<SampleJudgeDetail> {
  const investigateFn = deps.investigate ?? investigate;
  const analysis = await analyzeStructure(sample.messageBody);
  if (analysis.degraded) {
    return {
      score: 0,
      degraded: true,
      perceivedLevers: null,
      leverScore: 0,
      knownScamBonusRaw: 0,
      otherInvestigationBonusRaw: 0,
    };
  }
  const investigation = await investigateFn({
    message: sample.messageBody,
    levers: analysis.levers,
  });
  const result = await judge(analysis.levers, investigation);
  let knownScamBonusRaw = 0;
  let otherInvestigationBonusRaw = 0;
  for (const item of result.investigationBonus.items) {
    if (item.source === "knownScams") knownScamBonusRaw += item.points;
    else otherInvestigationBonusRaw += item.points;
  }
  return {
    score: result.score,
    degraded: false,
    perceivedLevers: analysis.levers,
    leverScore: computeScore(analysis.levers),
    knownScamBonusRaw,
    otherInvestigationBonusRaw,
  };
}

export async function judgeSampleViaPipeline(
  sample: Sample,
  deps: { investigate?: InvestigateFn } = {},
): Promise<{ score: number }> {
  const { score } = await judgeSampleDetailed(sample, deps);
  return { score };
}

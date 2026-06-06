import type { AttackPattern, BenignDifficulty } from "@/types/attackPattern";
import { getDetectionThreshold } from "@/lib/metrics";
import { INVESTIGATION_BONUS_CAP } from "@/lib/weights";

// 柱2 の「計器」── 実物ホールドアウト評価の判定規約を *純関数で凍結* する。
//
// 凍結の目的（fishing 構造的封じ）: 4分類 attribution の定義・FPR 下界の出し方・
// recall 生カウント規約・「伸びは known-scam 由来か」の counterfactual を、実物の
// 数字を見る *前* にコード＋テストで確定しコミットする。実物が入ったら判定は
// この凍結器から読み出すだけ＝結果を見てから metric をいじる余地を消す
// （docs/HANDOFF.md §5-B、「凍結fixture＋変更を見ていない新holdout」をハーネス自身に適用）。
//
// この層に LLM・firestore・ネットワークは入らない（決定論＝テスト対象）。実 Gemini を
// 通す signal 生産は runner（scripts/evalRealHoldout.ts）側＝ログで扱う。

type Levers = AttackPattern["levers"];

// 1サンプルの判定素材。runner が judge パイプライン（analyzeStructure→investigate→judge）
// から組み立て、ここに渡す。レバー素点と bonus 内訳を *生の点* で持つ（cap 前）。
export type SampleSignals = {
  id: string;
  kind: "scam" | "benign";
  // analyzeStructure が失敗（Gemini 縮退）＝知覚そのものが成立せず。
  degraded: boolean;
  // 知覚されたレバー（degraded 時は null）。missed-perception 判定に使う。
  perceivedLevers: Levers | null;
  // 最終 0-100（runner が judge から取得＝ leverScore + capped bonus, ≤100）。
  score: number;
  // レバー素点（computeScore、isolation floor 込み・bonus 前）。
  leverScore: number;
  // bonus 生点（cap 25 前）。known-scam＝self-play corpus 由来、それ以外＝外部調査。
  knownScamBonusRaw: number;
  otherInvestigationBonusRaw: number;
  // benign のみ: 効き目帯（easy control / effective stressor）。FPR を帯別に割るための
  // ラベル。scam では無視。未指定の benign は "easy" 扱い（最も楽観側へ寄せる）。
  benignDifficulty?: BenignDifficulty;
};

// 4分類 attribution（HANDOFF §5-B.3）:
//  - detected: score ≥ threshold。
//  - missed-floored: 知覚は成立（攻撃骨格を抽出）したが score < threshold
//      ＝床ゲートで取りこぼし。柱1(i) 床見直しの正しい動機。
//  - missed-perception: analyzeStructure が攻撃骨格を抽出できず（素の良性レバー）。
//      検知器以前の知覚失敗。
//  - degraded: Gemini 失敗で解析縮退（別報告）。
export type Attribution =
  | "detected"
  | "missed-floored"
  | "missed-perception"
  | "degraded";

// 「知覚が攻撃骨格を見たか」の *構造述語*（チューニング閾値ではない＝凍結しても恣意性が低い）。
// 良性メッセージにも CTA・軽い権威・リンクは出るので、それらでは true にしない。
// 詐欺を詐欺たらしめる *能動的な強レバー* のいずれかが立っていれば「知覚成立」とする:
//   - 孤立化（secrecy / bypass_approval / direct_channel ＝ none 以外）
//   - 高強度 urgency（intensity ≥ 2）
//   - 権威なりすまし（impersonates ≠ none）
//   - 直接金銭/資格情報 CTA（transfer_money / input_credentials）
//   - 狙い撃ち personalization（targeted、または個別シグナルあり）
// これに当たらず score も床下なら、骨格を *見ていない*＝missed-perception。
export function isPerceivedAttack(levers: Levers): boolean {
  return (
    levers.isolation.tactic !== "none" ||
    levers.urgency.intensity >= 2 ||
    levers.authority.impersonates !== "none" ||
    levers.callToAction.action === "transfer_money" ||
    levers.callToAction.action === "input_credentials" ||
    levers.personalization.level === "targeted" ||
    levers.personalization.signals.length > 0
  );
}

export function classifyAttribution(
  s: SampleSignals,
  threshold: number,
): Attribution {
  if (s.degraded) return "degraded";
  if (s.score >= threshold) return "detected";
  if (s.perceivedLevers && isPerceivedAttack(s.perceivedLevers))
    return "missed-floored";
  return "missed-perception";
}

// bonus 合算は判定器と同じ cap を再現（cap 後の値で counterfactual を測る）。
function cappedBonus(knownScamRaw: number, otherRaw: number): number {
  return Math.min(INVESTIGATION_BONUS_CAP, knownScamRaw + otherRaw);
}

function scoreFrom(leverScore: number, knownScamRaw: number, otherRaw: number): number {
  return Math.min(100, leverScore + cappedBonus(knownScamRaw, otherRaw));
}

// 検出サンプルが「何で検出できたか」の counterfactual 内訳。
// warm の recall 増が self-play corpus（known-scam bonus）由来か、外部調査由来か、
// レバー素点だけで足りたかを切り分ける（self-play 貢献の過大評価を防ぐ・§5-B.3）。
export type DetectionDrivers = {
  // レバー素点だけで閾値到達（bonus 不要）。
  leverAlone: number;
  // known-scam bonus を外すと床下に落ちる＝corpus 依存の検出。
  dependsOnKnownScam: number;
  // 外部調査 bonus を外すと床下に落ちる＝調査依存の検出。
  dependsOnInvestigation: number;
};

// FPR は *帯別に* 出す（pool 禁止）。pool すると easy の FPR≈0 が effective の FP を
// 薄めて単一の楽観値になり、床下げの危険が見えなくなる（道A の主報告は帯別 FPR）。
export type FprCell = {
  benignTotal: number;
  falseFlagged: number;
  // easy=true（楽観・真の FPR の下界） / effective=false（保守側＝下界扱いにしない）。
  fprIsLowerBound: boolean;
};

export type HoldoutSummary = {
  threshold: number;
  // recall は生カウント（小標本では率に丸めない・§5-B.3）。
  scamTotal: number;
  detected: number;
  byClass: Record<Attribution, number>; // scam 集合のみ
  drivers: DetectionDrivers;
  // FPR は帯別（easy / effective）に生カウントで持つ。主報告はこの帯別セル。
  // pooled な単一 FPR は意図的に持たない（主報告で pool しないため）。
  benignTotal: number; // 帯をまたいだ総数（参考・recall と桁を合わせる用途のみ）。
  fprByDifficulty: Partial<Record<BenignDifficulty, FprCell>>;
  smallSample: boolean; // n < SMALL_SAMPLE_N → 率でなく X/n で語る合図。
};

// 帯から下界フラグを引く（構造的性質＝easy は楽観側で下界、effective は保守側）。
function fprIsLowerBoundFor(difficulty: BenignDifficulty): boolean {
  return difficulty === "easy";
}

// 「点で率を出さず X/n で語る」境界。n がこの未満なら小標本扱い（§5-B.3, n≈20）。
export const SMALL_SAMPLE_N = 30;

export function summarizeHoldout(
  signals: SampleSignals[],
  opts: { threshold?: number } = {},
): HoldoutSummary {
  const threshold = opts.threshold ?? getDetectionThreshold();

  const scams = signals.filter((s) => s.kind === "scam");
  const benigns = signals.filter((s) => s.kind === "benign");

  const byClass: Record<Attribution, number> = {
    detected: 0,
    "missed-floored": 0,
    "missed-perception": 0,
    degraded: 0,
  };
  const drivers: DetectionDrivers = {
    leverAlone: 0,
    dependsOnKnownScam: 0,
    dependsOnInvestigation: 0,
  };

  for (const s of scams) {
    const cls = classifyAttribution(s, threshold);
    byClass[cls] += 1;
    if (cls !== "detected") continue;
    if (s.leverScore >= threshold) drivers.leverAlone += 1;
    // counterfactual: その bonus 源を 0 にしたら床下に落ちるか。
    if (scoreFrom(s.leverScore, 0, s.otherInvestigationBonusRaw) < threshold)
      drivers.dependsOnKnownScam += 1;
    if (scoreFrom(s.leverScore, s.knownScamBonusRaw, 0) < threshold)
      drivers.dependsOnInvestigation += 1;
  }

  // 帯別 FPR: benign を benignDifficulty（未指定は "easy"）でグループ化し、各帯で
  // falseFlagged / benignTotal を生カウント。fprIsLowerBound は帯の構造的性質から引く。
  const fprByDifficulty: Partial<Record<BenignDifficulty, FprCell>> = {};
  for (const b of benigns) {
    const difficulty: BenignDifficulty = b.benignDifficulty ?? "easy";
    const cell = (fprByDifficulty[difficulty] ??= {
      benignTotal: 0,
      falseFlagged: 0,
      fprIsLowerBound: fprIsLowerBoundFor(difficulty),
    });
    cell.benignTotal += 1;
    if (b.score >= threshold) cell.falseFlagged += 1;
  }

  return {
    threshold,
    scamTotal: scams.length,
    detected: byClass.detected,
    byClass,
    drivers,
    benignTotal: benigns.length,
    fprByDifficulty,
    smallSample: scams.length < SMALL_SAMPLE_N,
  };
}

// ── 道A 着地: 膝を「点」でなく X/n＋区間で語るための純関数群 ──
//
// 位置づけ（fishing でないことの明示）: ここは床値・閾値・検出規約（majority/床 grid）を
// 一切変えない。事前登録した X/n の生カウントに Wilson 95% 区間を当てて *正直に幅を出す*
// だけ。結果を見てから metric を差し替える事後変更ではなく、既存 metric の区間表示。
// n=6 のような小標本で「点」を断定しない（§5-B.3「率に丸めない」の区間版）。

export type WilsonInterval = {
  p: number; // 点推定 x/n
  lo: number; // 95% 下限（[0,1] にクランプ）
  hi: number; // 95% 上限（[0,1] にクランプ）
};

// Wilson score interval（z=1.96, 95%）。小標本でも 0/1 境界で破綻しない
// （scripts/probeRateConvergence.ts と同一実装＝計器として凍結）。
export function wilsonInterval(x: number, n: number): WilsonInterval {
  if (n === 0) return { p: 0, lo: 0, hi: 0 };
  const z = 1.96;
  const p = x / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    p,
    lo: Math.max(0, center - half),
    hi: Math.min(1, center + half),
  };
}

// 区間が値（既定 0.5）をまたぐか。per-sample 検出率の CI が 0.5 をまたぐ＝多数決が
// 確率的に裏返る「床際コインフリップ」の判定に使う。
export function ciCrosses(ci: WilsonInterval, value = 0.5): boolean {
  return ci.lo <= value && ci.hi >= value;
}

// 2 区間が重なるか。床 60 と床 62 の recall CI が「重なる/分離」を割るのに使う
// （分離して初めて床差に統計的意味がある）。
export function ciOverlap(a: WilsonInterval, b: WilsonInterval): boolean {
  return a.lo <= b.hi && b.lo <= a.hi;
}

// K-run の保存スコア行列の1行（id＋kind＋帯＋K ドローの score 列）。
// これは LLM を通さない再 threshold 専用の生データ（凍結 fixture）。
export type ScoreRow = {
  id: string;
  kind: "scam" | "benign";
  benignDifficulty?: BenignDifficulty;
  scores: number[];
};

// 多数決検出: detectedCount/K ≥ 0.5 で「その床で検出/誤検出」とみなす（事前登録規約）。
// evalRealHoldout の runner と計器で同一定義を共有するため、ここを正本にする。
export function majorityFlagged(scores: number[], floor: number): boolean {
  if (scores.length === 0) return false;
  const hit = scores.filter((s) => s >= floor).length;
  return hit / scores.length >= 0.5;
}

// per-sample 検出率（K ドロー中 floor 以上の割合）＋ Wilson CI＋床際コインフリップ旗。
export type SampleDetection = {
  id: string;
  hit: number;
  n: number;
  ci: WilsonInterval;
  knifeEdge: boolean; // CI が 0.5 をまたぐ＝多数決が裏返りうる
};

export function sampleDetectionRate(
  id: string,
  scores: number[],
  floor: number,
): SampleDetection {
  const hit = scores.filter((s) => s >= floor).length;
  const n = scores.length;
  const ci = wilsonInterval(hit, n);
  return { id, hit, n, ci, knifeEdge: ciCrosses(ci, 0.5) };
}

// 集合の「多数決検出された件数 X / 総数 n」＋ Wilson CI（recall・FPR の帯バンド）。
export type BandCell = {
  x: number; // 多数決で検出（誤検出）された *サンプル* 数
  n: number; // 帯の総サンプル数
  ci: WilsonInterval;
};

function bandCell(rows: ScoreRow[], floor: number): BandCell {
  const x = rows.filter((r) => majorityFlagged(r.scores, floor)).length;
  const n = rows.length;
  return { x, n, ci: wilsonInterval(x, n) };
}

// 1 床あたりの recall バンド＋帯別 FPR バンド（pool 禁止＝帯ごとに別 CI）。
// 帯に1件もなければ null（「測定不能」＝主張しない）。
export type FloorBand = {
  floor: number;
  recall: BandCell;
  fprEasy: BandCell | null;
  fprEffective: BandCell | null;
};

// 保存スコア行列を床 grid へ事後 re-threshold し、床×{recall, FPR 帯別} をバンドで出す。
// LLM コール追加ゼロ。床は選ばない（曲線を返すだけ）。
export function floorSweepBands(
  rows: ScoreRow[],
  floors: readonly number[],
): FloorBand[] {
  const scam = rows.filter((r) => r.kind === "scam");
  const easy = rows.filter(
    (r) => r.kind === "benign" && (r.benignDifficulty ?? "easy") === "easy",
  );
  const eff = rows.filter(
    (r) => r.kind === "benign" && r.benignDifficulty === "effective",
  );
  return floors.map((floor) => ({
    floor,
    recall: bandCell(scam, floor),
    fprEasy: easy.length > 0 ? bandCell(easy, floor) : null,
    fprEffective: eff.length > 0 ? bandCell(eff, floor) : null,
  }));
}

// BEFORE(cold) → AFTER(warm) の差分。伸びの解釈は drivers と併読する。
export type HoldoutDelta = {
  before: HoldoutSummary;
  after: HoldoutSummary;
  detectedDelta: number; // after.detected - before.detected（生カウント差）
};

export function compareHoldout(
  before: HoldoutSummary,
  after: HoldoutSummary,
): HoldoutDelta {
  return {
    before,
    after,
    detectedDelta: after.detected - before.detected,
  };
}

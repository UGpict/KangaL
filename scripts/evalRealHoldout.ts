// 柱2: 外部実物ホールドアウトの cold+warm BEFORE/AFTER 実測 runner。
//
// 実行（headline = live investigate）:
//   GOOGLE_CLOUD_PROJECT=ai-bridging GOOGLE_CLOUD_LOCATION=us-central1 \
//   DEMO_MODE=true INTEGRATION=1 npx tsx scripts/evalRealHoldout.ts
// 要 Vertex ADC + Firestore datastore.user。実物 holdout（realScamHoldout）が
// 投入済みであること（seed:holdout）。未投入なら拒否。
//
// 設計（docs/HANDOFF.md §5-B）:
//  - 判定の解釈はすべて *凍結済み計器* src/lib/holdoutEval.ts から読み出す（fishing 封じ）。
//  - BEFORE(cold) = 現コーパスのまま実物 holdout を評価。AFTER(warm) = self-play で
//    コーパスを育てた後に同じ集合を再評価。伸びは drivers（known-scam 由来か調査由来か）
//    と併読する。investigate は LIVE（matchKnownScams が現コーパスを反映する＝warm の
//    treatment はコーパス成長そのもの）。
//  - benign は実物 holdout（realBenignHoldout）から帯ラベル付き（easy/effective）で読む。
//    FPR は *帯別* に出す（pool 禁止）: easy=楽観・下界 / effective=保守側ストレッサー。
//    benign が空でも続行（scam recall は出せる／FPR は「主張しない」）。
//  - K-run（--freeze-investigation）は *固定コーパス* 上で investigate を1回だけ実行して
//    凍結し、analyzeStructure の知覚揺れだけを K 回観測する within-condition モード
//    （BEFORE/AFTER 比較とは別物。コーパスを育てない）。scam＋benign を同一 pass で回し、
//    保存スコア行列を事前登録 床 grid {70,65,62,60,58,55} へ事後 re-threshold して
//    床×difficulty×{recall,FPR} を出す（LLM コール追加ゼロ）。床は人間が決める。
//
// 数字は脚色しない: 実物 recall が低くても現在地として出す（§5-B「正直な期待値」）。

process.env.DEMO_MODE = process.env.DEMO_MODE ?? "true";

import { runLoop } from "@/agents/loop";
import {
  judgeSampleDetailed,
  type SampleJudgeDetail,
  type InvestigateFn,
} from "@/agents/judgeSample";
import { analyzeStructure } from "@/agents/analyzeStructure";
import { investigate } from "@/agents/investigate";
import { listRealScamHoldout } from "@/lib/realScamHoldout";
import { listRealBenignHoldout } from "@/lib/realBenignHoldout";
import {
  compareHoldout,
  floorSweepBands,
  majorityFlagged,
  sampleDetectionRate,
  summarizeHoldout,
  type BandCell,
  type HoldoutSummary,
  type SampleSignals,
  type WilsonInterval,
} from "@/lib/holdoutEval";
import { getDetectionThreshold } from "@/lib/metrics";
import type { InvestigationReport } from "@/types/investigation";
import type { BenignDifficulty, Sample } from "@/types/attackPattern";

// benign は per-sample 帯ラベルを携える（FPR を帯別に割るため）。scam では undefined。
type LabeledSample = {
  id: string;
  sample: Sample;
  benignDifficulty?: BenignDifficulty;
};

function detailToSignal(
  id: string,
  kind: "scam" | "benign",
  d: SampleJudgeDetail,
  benignDifficulty?: BenignDifficulty,
): SampleSignals {
  return {
    id,
    kind,
    degraded: d.degraded,
    perceivedLevers: d.perceivedLevers,
    score: d.score,
    leverScore: d.leverScore,
    knownScamBonusRaw: d.knownScamBonusRaw,
    otherInvestigationBonusRaw: d.otherInvestigationBonusRaw,
    ...(kind === "benign" ? { benignDifficulty: benignDifficulty ?? "easy" } : {}),
  };
}

async function evaluateAll(labeled: LabeledSample[]): Promise<SampleSignals[]> {
  const out: SampleSignals[] = [];
  for (const { id, sample, benignDifficulty } of labeled) {
    const detail = await judgeSampleDetailed(sample); // LIVE investigate
    out.push(detailToSignal(id, sample.kind, detail, benignDifficulty));
  }
  return out;
}

function printSummary(label: string, s: HoldoutSummary): void {
  console.log(`\n[${label}] threshold=${s.threshold}`);
  console.log(
    `  recall(生): ${s.detected}/${s.scamTotal}` +
      (s.smallSample ? "  ※小標本＝率に丸めない" : ""),
  );
  console.log(
    `  4分類: detected=${s.byClass.detected} / missed-floored=${s.byClass["missed-floored"]} / ` +
      `missed-perception=${s.byClass["missed-perception"]} / degraded=${s.byClass.degraded}`,
  );
  console.log(
    `  drivers: leverAlone=${s.drivers.leverAlone} / dependsOnKnownScam=${s.drivers.dependsOnKnownScam} / ` +
      `dependsOnInvestigation=${s.drivers.dependsOnInvestigation}`,
  );
  // FPR は帯別に出す（pool 禁止＝easy の 0 が effective の FP を薄めないように）。
  const bands: BenignDifficulty[] = ["easy", "effective"];
  const present = bands.filter((b) => s.fprByDifficulty[b]);
  if (present.length === 0) {
    console.log(`  FPR(生): benign=0（FPR について何も主張しない）`);
  } else {
    for (const b of present) {
      const cell = s.fprByDifficulty[b]!;
      console.log(
        `  FPR(生)[${b}]: ${cell.falseFlagged}/${cell.benignTotal}` +
          (cell.fprIsLowerBound
            ? "  ※easy＝楽観・真の FPR の下界"
            : "  ※effective＝保守側ストレッサー"),
      );
    }
    if (!present.includes("effective")) {
      console.log(
        "  ※ effective 帯 0 件＝商用ストレッサー未投入。床下げの FP 危険はまだ測れない。",
      );
    }
  }
}

// 道A の事前登録 床 grid。結果を見て足さない（事後いじり禁止）。70 が現行床。
const FLOOR_GRID = [70, 65, 62, 60, 58, 55] as const;

type KRunRow = {
  id: string;
  kind: "scam" | "benign";
  benignDifficulty?: BenignDifficulty;
  scores: number[];
  knownScamMax: number;
};

// 多数決検出（majorityFlagged）は凍結計器 holdoutEval から共有（定義の二重化を避ける）。

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}
function ciStr(ci: WilsonInterval): string {
  return `${pct(ci.p)}[${pct(ci.lo)}-${pct(ci.hi)}]`;
}
function cell(c: BandCell | null): string {
  return c === null ? "n/a" : `${c.x}/${c.n} ${ciStr(c.ci)}`;
}

async function freezeInvestigationKRun(
  labeled: LabeledSample[],
  k: number,
  threshold: number,
): Promise<void> {
  // within-condition（固定コーパス）: investigate を *実物 report* で1回だけ凍結し、
  // judge を K 回。非決定は analyzeStructure（知覚＝レバー素点）だけに絞られる。
  //
  // 狙い1（道A の的を割る）: per-sample 検出率で2つの「<threshold」を区別する。
  //   (a) 床下      = 0/K か K/K に張り付く＝構造的取りこぼし（床/投資ボーナスの対象）。
  //   (b) 境界ジッタ = 中間（~0.5）＝threshold 上下を確率的に跨ぐ＝分散の問題。
  // 狙い2（床トレードオフ）: 保存した score 行列を床 grid へ *事後 re-threshold* する。
  //   LLM コール追加ゼロ。床×difficulty×{recall, FPR} を出す（FPR は帯別＝pool 禁止）。
  // 主軸は dependsOnKnownScam=false サブセットの検出率（knownScamBonus を併記）。
  console.log(`\n=== K-run（--freeze-investigation, k=${k}, threshold=${threshold}, 固定コーパス）===`);
  console.log(
    "  investigate を実物 report で1回凍結→ judge を K 回（analyzeStructure のみ再実行）。\n" +
      "  scam: detRate (a)床下=0/K|K/K張り付き / (b)境界ジッタ=中間。benign: 同じ多数決で FP 判定。\n" +
      "  但し書き: investigation は各サンプル1ドローで固定＝ここで測るのは lever-score 分散のみ。\n" +
      "  凍結ドローが高/低に出ると検出率の絶対値が嵩上げ/嵩下げされる（(a)/(b) の相対判定は\n" +
      "  lever-score 分散が決めるので生きる）。investigation 分散込みの完全分布は別物（非凍結多重 run）。",
  );

  const rows: KRunRow[] = [];
  for (const { id, sample, benignDifficulty } of labeled) {
    // 凍結シード: live analyze → live investigate を1回だけ実行し、その実物 report を固定。
    // 以降の K 回はこの report を再利用＝investigation は run 間で不変（分散源から除外）。
    const seedAnalysis = await analyzeStructure(sample.messageBody);
    const frozenReport: InvestigationReport = seedAnalysis.degraded
      ? ({ truncated: false, truncatedReason: null } as InvestigationReport)
      : await investigate({
          message: sample.messageBody,
          levers: seedAnalysis.levers,
        });
    const frozenInvestigate: InvestigateFn = async () => frozenReport;

    const scores: number[] = [];
    let knownScamMax = 0;
    for (let i = 0; i < k; i++) {
      const d = await judgeSampleDetailed(sample, {
        investigate: frozenInvestigate,
      });
      scores.push(d.score);
      knownScamMax = Math.max(knownScamMax, d.knownScamBonusRaw);
    }
    rows.push({
      id,
      kind: sample.kind,
      benignDifficulty,
      scores,
      knownScamMax,
    });

    const detected = scores.filter((s) => s >= threshold).length;
    const spread = Math.max(...scores) - Math.min(...scores);
    // per-sample 検出率に Wilson CI を当て、CI が 0.5 をまたぐ＝床際コインフリップを明示。
    const det = sampleDetectionRate(id, scores, threshold);
    const edge = det.knifeEdge ? " ★床際コインフリップ(CI が0.5をまたぐ)" : "";
    if (sample.kind === "scam") {
      const cls =
        detected === 0 ? "床下(a)" : detected === k ? "常時検出" : "境界ジッタ(b)";
      console.log(
        `  [scam] ${id}: detRate=${detected}/${k} ${ciStr(det.ci)} [${cls}]${edge} ` +
          `scores=[${scores.join(",")}] spread=${spread} knownScamBonus(max)=${knownScamMax}`,
      );
    } else {
      const band = benignDifficulty ?? "easy";
      console.log(
        `  [benign/${band}] ${id}: flagRate=${detected}/${k} ${ciStr(det.ci)}${edge} ` +
          `scores=[${scores.join(",")}] spread=${spread}`,
      );
    }
  }

  // ── 床 sweep（保存スコアへの事後 re-threshold・LLM コール追加ゼロ）──
  const scamRows = rows.filter((r) => r.kind === "scam");
  const benignRows = rows.filter((r) => r.kind === "benign");
  const easyRows = benignRows.filter((r) => (r.benignDifficulty ?? "easy") === "easy");
  const effRows = benignRows.filter((r) => r.benignDifficulty === "effective");

  console.log(
    `\n=== 床 sweep（多数決 detectedCount/K≥0.5・保存スコア re-threshold）===\n` +
      `  recall=scam検出/${scamRows.length}（主軸: 全件 dependsOnKnownScam=false 前提）。\n` +
      `  FPR は帯別（pool 禁止）: easy=${easyRows.length}件（楽観・下界） / effective=${effRows.length}件（保守側）。`,
  );
  if (effRows.length === 0) {
    console.log(
      "  ※ effective 帯 0 件＝商用ストレッサー未投入。FPR[effective] は測定不能（床決定は保留）。",
    );
  }
  // 床 sweep を「点」でなくバンド（X/n＋Wilson95%CI）で出す。小標本（n=6 等）で recall を
  // 断定しないため。床値・閾値・多数決規約は不変＝これは事後 metric 変更でなく区間表示。
  console.log(`  床 | recall (X/n[CI]) | FPR[easy] (X/n[CI]) | FPR[effective]`);
  const bands = floorSweepBands(rows, FLOOR_GRID);
  for (const band of bands) {
    const mark = band.floor === threshold ? " ←現行床" : "";
    console.log(
      `  ${band.floor} | ${cell(band.recall)} | ${cell(band.fprEasy)} | ${cell(band.fprEffective)}${mark}`,
    );
  }
  // 隣接床の recall CI が重なるか分離するか（分離して初めて床差に統計的意味がある）。
  const overlapNote = (() => {
    const find = (f: number) => bands.find((b) => b.floor === f);
    const pairs: Array<[number, number]> = [
      [62, 60],
      [60, 58],
    ];
    const out: string[] = [];
    for (const [a, b] of pairs) {
      const ba = find(a);
      const bb = find(b);
      if (!ba || !bb) continue;
      const ov = ba.recall.ci.lo <= bb.recall.ci.hi && bb.recall.ci.lo <= ba.recall.ci.hi;
      out.push(`床${a}↔${b}: recall CI は${ov ? "重なる（差は有意でない）" : "分離"}`);
    }
    return out.join(" / ");
  })();
  if (overlapNote) console.log(`  CI 重なり: ${overlapNote}`);
  console.log(
    "  読み: 小標本では recall は点でなくバンド。隣接床の CI が重なる間は床差に意味がない。\n" +
      "  床を下げると recall↑だが effective FPR↑。曲線を見て *人間が* 床を決める（コードは選ばない）。\n" +
      "  effective が空の間は recall↑と easy FPR の安全性下界までしか言えない。",
  );
}

async function main(): Promise<number> {
  if (process.env.INTEGRATION !== "1") {
    console.error("Refusing to run: set INTEGRATION=1（実 Gemini/Firestore を使う確認）。");
    return 1;
  }
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    console.error("GOOGLE_CLOUD_PROJECT is required.");
    return 1;
  }

  const holdout = await listRealScamHoldout();
  if (holdout.length === 0) {
    console.error(
      "realScamHoldout が空です。seed:holdout で実物を provenance 付きで投入してから実行してください。",
    );
    return 1;
  }
  // benign は実物 holdout（realBenignHoldout）から帯ラベル付きで読む。空でも続行する
  // （scam recall は出せる／FPR は「benign=0＝主張しない」になる）。
  const benign = await listRealBenignHoldout();
  const threshold = getDetectionThreshold();
  const warmRounds = Number(process.env.WARM_ROUNDS ?? "5");
  const warmLineages = Number(process.env.WARM_LINEAGES ?? "3");

  const scamLabeled: LabeledSample[] = holdout.map((h) => ({
    id: h.id,
    sample: { kind: "scam", messageBody: h.messageBody },
  }));
  const benignLabeled: LabeledSample[] = benign.map((b) => ({
    id: b.id,
    sample: { kind: "benign", messageBody: b.messageBody },
    benignDifficulty: b.benignDifficulty,
  }));
  const all = [...scamLabeled, ...benignLabeled];

  const easyCount = benign.filter((b) => b.benignDifficulty === "easy").length;
  const effCount = benign.filter((b) => b.benignDifficulty === "effective").length;
  console.log(
    `=== 柱2 実物ホールドアウト cold+warm 実測 ===\n` +
      `holdout(scam)=${holdout.length} / benign=${benign.length}` +
      `（easy=${easyCount} / effective=${effCount}） / threshold=${threshold}`,
  );
  if (effCount === 0) {
    console.log(
      "  ※ effective 帯 0 件＝商用ストレッサー未投入。床下げの FP 危険は未測定（停止点どおり）。",
    );
  }
  // provenance を一覧（出所が割れているほど漏洩リスクは下がる・出所分離の監査）。
  const sources = new Map<string, number>();
  for (const h of holdout) {
    const src = h.provenance.source || "(不明)";
    sources.set(src, (sources.get(src) ?? 0) + 1);
  }
  console.log(
    `  出所内訳: ${[...sources.entries()].map(([s, n]) => `${s}:${n}`).join(" / ")}`,
  );

  if (process.argv.includes("--freeze-investigation")) {
    // scam＋benign を同一 K-run pass で回す（床 sweep で recall と帯別 FPR を同時に出す）。
    await freezeInvestigationKRun(all, Number(process.env.KRUN ?? "5"), threshold);
    return 0;
  }

  // BEFORE(cold): 現コーパスのまま。
  console.log("\n[BEFORE/cold] 現コーパスで実物 holdout を評価（live investigate）...");
  const beforeSignals = await evaluateAll(all);
  const before = summarizeHoldout(beforeSignals, { threshold });
  printSummary("BEFORE/cold", before);

  // WARM: self-play でコーパスを育てる（実 generateAttackPattern＝recon シード）。
  console.log(
    `\n[WARM] self-play でコーパス成長: ${warmLineages} 系統 × maxRounds=${warmRounds} ...`,
  );
  for (let i = 0; i < warmLineages; i++) {
    const r = await runLoop({ maxRounds: warmRounds });
    console.log(
      `  系統 ${i + 1}: rounds=${r.totalRounds} / finalDetected=${r.finalDetected}`,
    );
  }

  // AFTER(warm): 同じ集合を再評価。
  console.log("\n[AFTER/warm] コーパス成長後に同じ集合を再評価...");
  const afterSignals = await evaluateAll(all);
  const after = summarizeHoldout(afterSignals, { threshold });
  printSummary("AFTER/warm", after);

  const delta = compareHoldout(before, after);
  console.log(
    `\n[DELTA] detected: ${before.detected} → ${after.detected} (Δ=${delta.detectedDelta}, 生カウント)`,
  );
  console.log(
    "  解釈: Δ の内訳は AFTER の drivers.dependsOnKnownScam（self-play corpus 由来）と\n" +
      "  dependsOnInvestigation を併読。known-scam 由来が支配的なら『暗記寄り』、lever/investigation\n" +
      "  由来なら『汎化寄り』。実物への主張は『自作プローブへの汎化（柱1）』と分けて語る。",
  );

  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error("evalRealHoldout crashed:", e);
    process.exit(2);
  });

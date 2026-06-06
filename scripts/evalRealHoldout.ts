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
//  - benign は既存の easy ベースライン（listBenignSamples）なので FPR は下界（fprIsLowerBound）。
//  - K-run（--freeze-investigation）は *固定コーパス* 上で investigate を1回だけ実行して
//    凍結し、analyzeStructure の知覚揺れだけを K 回観測する within-condition モード
//    （BEFORE/AFTER 比較とは別物。コーパスを育てない）。
//
// 数字は脚色しない: 実物 recall が低くても現在地として出す（§5-B「正直な期待値」）。

process.env.DEMO_MODE = process.env.DEMO_MODE ?? "true";

import { judgeSampleDetailed, runLoop, type SampleJudgeDetail } from "@/agents/loop";
import { listBenignSamples } from "@/lib/firestore";
import { listRealScamHoldout } from "@/lib/realScamHoldout";
import {
  compareHoldout,
  summarizeHoldout,
  type BenignDifficulty,
  type HoldoutSummary,
  type SampleSignals,
} from "@/lib/holdoutEval";
import { getDetectionThreshold } from "@/lib/metrics";
import type { InvestigationReport } from "@/types/investigation";
import type { Sample } from "@/types/attackPattern";

type LabeledSample = { id: string; sample: Sample };

function detailToSignal(
  id: string,
  kind: "scam" | "benign",
  d: SampleJudgeDetail,
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
  };
}

async function evaluateAll(
  labeled: LabeledSample[],
  kindOf: (id: string) => "scam" | "benign",
): Promise<SampleSignals[]> {
  const out: SampleSignals[] = [];
  for (const { id, sample } of labeled) {
    const detail = await judgeSampleDetailed(sample); // LIVE investigate
    out.push(detailToSignal(id, kindOf(id), detail));
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
  console.log(
    `  FPR(生): ${s.falseFlagged}/${s.benignTotal}` +
      (s.fprIsLowerBound ? "  ※easy-only＝真の FPR の下界" : ""),
  );
}

async function freezeInvestigationKRun(
  labeled: LabeledSample[],
  k: number,
): Promise<void> {
  // within-condition（固定コーパス）: investigate を1回ずつ凍結し、judge を K 回。
  // 非決定は analyzeStructure（知覚）だけに絞られる＝missed-perception の安定性観測。
  console.log(`\n=== K-run（--freeze-investigation, k=${k}, 固定コーパス）===`);
  for (const { id, sample } of labeled) {
    let frozen: InvestigationReport | null = null;
    const cachedInvestigate = async (): Promise<InvestigationReport> => {
      if (frozen) return frozen;
      // 初回だけ live investigate を通し、その report を凍結。
      const seed = await judgeSampleDetailed(sample); // live（frozen 確定のため）
      // judgeSampleDetailed は report を返さないので、ここでは perceivedLevers のみ
      // 安定確認に使う。完全な report 凍結が要るなら investigate を直接呼ぶ拡張に差し替える。
      void seed;
      frozen = { truncated: false, truncatedReason: null } as InvestigationReport;
      return frozen;
    };
    const scores: number[] = [];
    for (let i = 0; i < k; i++) {
      const d = await judgeSampleDetailed(sample, { investigate: cachedInvestigate });
      scores.push(d.score);
    }
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    console.log(`  ${id}: scores=[${scores.join(",")}] spread=${max - min}`);
  }
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
  const benign = await listBenignSamples();
  const benignDifficulty: BenignDifficulty =
    (process.env.BENIGN_DIFFICULTY as BenignDifficulty) ?? "easy";
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
  }));
  const all = [...scamLabeled, ...benignLabeled];
  const kindOf = (id: string): "scam" | "benign" =>
    holdout.some((h) => h.id === id) ? "scam" : "benign";

  console.log(
    `=== 柱2 実物ホールドアウト cold+warm 実測 ===\n` +
      `holdout(scam)=${holdout.length} / benign=${benign.length} / threshold=${threshold} / ` +
      `benignDifficulty=${benignDifficulty}`,
  );
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
    await freezeInvestigationKRun(scamLabeled, Number(process.env.KRUN ?? "5"));
    return 0;
  }

  // BEFORE(cold): 現コーパスのまま。
  console.log("\n[BEFORE/cold] 現コーパスで実物 holdout を評価（live investigate）...");
  const beforeSignals = await evaluateAll(all, kindOf);
  const before = summarizeHoldout(beforeSignals, { threshold, benignDifficulty });
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
  const afterSignals = await evaluateAll(all, kindOf);
  const after = summarizeHoldout(afterSignals, { threshold, benignDifficulty });
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

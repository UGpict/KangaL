// PLAN-v2 T2 診断専用ハーネス（観測のみ・閉ループは実装しない）。
// 目的: V1（防御側が静的＝回復機構が無い）の予言どおり、素の実走で recall が
// 単調低下「しない」こと（＝回復しないこと、そもそも dip も出ないこと）を実測記録する。
//
// 実行: GOOGLE_CLOUD_PROJECT=ai-bridging GOOGLE_CLOUD_LOCATION=us-central1 \
//        DEMO_MODE=true npx tsx scripts/diagnose-loop-recall.ts
// 要 Vertex ADC。loop.ts / firestore.ts は一切変更していない。
//
// ── 観測の汚染を避けるための線引き（厳守） ────────────────────────────────
// 注入してよいのは「初期 seed」と「停止ポリシー」だけ。prompt・閾値・evolve ロジック
// は触らない。本ハーネスが差し替えるのは driver の for-loop（停止条件と seed の供給）
// のみで、investigate → judge → evolve の本体は loop.ts が呼ぶのと同一の step を
// 一字一句変えずに同一に呼ぶ（src からの import そのまま）。
//   - 停止ポリシー = no-break（固定 max-rounds で回し切り、検出後も止めない）。
//     これは「停止条件の注入」であって evolve ロジックの改変ではない。evolve は
//     feedback.detected===true で throw する契約なので、エスカレートを継続させる
//     ために毎ラウンド {detected:false} を渡す。これも停止条件側の選択であり、
//     evolve 本体・閾値・prompt は不変。
// ⇒ これにより T2-③ で「観測したのは本番（loop.ts）と同一手順」と言い切れる。
//
// 締めの確認は「固定の literal seed を複数本」回して曲線の分布を見る（1本=1サンプル
// なので形を一般化しない）。seed は実 BEC に近い subtle なもの（赤信号が薄い）を用い、
// Gemini の「攻撃を作れ」が出す教科書的カリカチュア（即検出）とは別の動態を観る。

process.env.DEMO_MODE = "true";

import { randomUUID } from "node:crypto";
import { runLoop, type RoundRecord } from "@/agents/loop";
import { computeScore, judge } from "@/agents/judge";
import { investigate } from "@/agents/investigate";
import { evolve } from "@/agents/attacker";
import { getDetectionThreshold, recordRound } from "@/lib/metrics";
import type { AttackPattern } from "@/types/attackPattern";

function leverDigest(p: AttackPattern): string {
  const l = p.levers;
  return [
    `ch=${p.channel}`,
    `urg=${l.urgency.intensity}`,
    `auth=${l.authority.impersonates}/tricks${l.authority.credibilityTricks.length}`,
    `inc=${l.incentive.intensity}`,
    `cta=${l.callToAction.action}/${l.callToAction.friction}`,
    `pers=${l.personalization.level}/sig${l.personalization.signals.length}`,
    `iso=${l.isolation.tactic}/${l.isolation.intensity}`,
  ].join(" ");
}

function fmtRecall(r: number | null): string {
  return r === null ? "—" : r.toFixed(2);
}

async function runOnce(label: string, maxRounds: number): Promise<void> {
  const threshold = getDetectionThreshold();
  console.log(`\n========== ${label} (threshold=${threshold}, maxRounds=${maxRounds}) ==========`);
  const t0 = Date.now();
  const result = await runLoop({ maxRounds });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // cumulative recall = （検出されたラウンド数）/（ここまでのラウンド数）
  let detectedCount = 0;
  const scores: number[] = [];
  console.log(
    "round | gen | leverScore | totalScore | bonus | detected | perRoundRecall | cumRecall | levers",
  );
  for (const r of result.rounds as RoundRecord[]) {
    const leverScore = computeScore(r.pattern.levers);
    const total = r.result.score;
    const bonus = total - leverScore;
    if (r.result.detected) detectedCount += 1;
    const cumRecall = detectedCount / r.round;
    scores.push(total);
    console.log(
      `  ${String(r.round).padStart(2)}  |  ${r.pattern.generation}  |    ${String(leverScore).padStart(3)}     |    ${String(total).padStart(3)}     |  +${bonus}  |   ${r.result.detected ? "YES" : "no "}   |     ${fmtRecall(r.metrics.recall)}      |   ${cumRecall.toFixed(2)}   | ${leverDigest(r.pattern)}`,
    );
  }

  // トラジェクトリ判定（脚色しない・機械的に）
  let monotonicNonDecreasing = true;
  let strictlyIncreasingSomewhere = false;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] < scores[i - 1]) monotonicNonDecreasing = false;
    if (scores[i] > scores[i - 1]) strictlyIncreasingSomewhere = true;
  }
  const anyDip = scores.some((s, i) => i > 0 && s < scores[i - 1]);
  const recovered = (() => {
    // 「下がってから戻る」= ある i で dip、その後 i 以前の値以上へ回復
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] < scores[i - 1]) {
        const floor = scores[i];
        for (let j = i + 1; j < scores.length; j++) {
          if (scores[j] > floor) return true;
        }
      }
    }
    return false;
  })();

  console.log("--- トラジェクトリ判定（機械的） ---");
  console.log(`  rounds run: ${result.totalRounds}, finalDetected: ${result.finalDetected}`);
  console.log(`  score 系列: [${scores.join(", ")}]`);
  console.log(`  単調非減少(score never drops): ${monotonicNonDecreasing}`);
  console.log(`  どこかで上昇: ${strictlyIncreasingSomewhere}`);
  console.log(`  dip(一度でも低下)があったか: ${anyDip}`);
  console.log(`  回復(dip後に戻る)があったか: ${recovered}`);
  console.log(`  elapsed: ${elapsed}s`);
}

// ── subtle な実 BEC 風の固定 literal seed（複数本） ─────────────────────────
// id 以外は完全に決定論的な literal。id は score に寄与しない（judge は levers のみで
// computeScore）ので、トラジェクトリの形は seed の levers のみで決まる。
// いずれも「赤信号が薄い」= 初期 score を低く取る型。実 gen1（Gemini）が出す
// カリカチュアと違い、洗練された BEC は検知器が初手で外しやすい、を観るための種。
type Seed = { name: string; note: string; pattern: AttackPattern };

function seedPattern(name: string, levers: AttackPattern["levers"]): AttackPattern {
  return {
    id: randomUUID(),
    generation: 1,
    sourceContext: `diagnostic-seed:${name}`,
    channel: "email",
    levers,
  };
}

const SEEDS: Seed[] = [
  {
    name: "bec-exec-wire",
    note: "CEO詐欺風: 役員なりすまし・丁寧文・送金依頼・社内語・小さな秘匿（赤信号薄）",
    pattern: seedPattern("bec-exec-wire", {
      urgency: { tactic: "none", intensity: 0 },
      authority: { impersonates: "executive", credibilityTricks: ["formal_tone"] },
      incentive: { type: "fear", hook: "penalty", intensity: 0 },
      callToAction: { action: "transfer_money", friction: "mid" },
      personalization: { level: "targeted", signals: ["internal_jargon"] },
      isolation: { tactic: "secrecy", intensity: 1 },
    }),
  },
  {
    name: "vendor-invoice",
    note: "取引先請求書風: business_partner・参照番号・スレッド差込・送金（urgency/incentive=0）",
    pattern: seedPattern("vendor-invoice", {
      urgency: { tactic: "none", intensity: 0 },
      authority: {
        impersonates: "business_partner",
        credibilityTricks: ["reference_number", "formal_tone"],
      },
      incentive: { type: "reward", hook: "refund", intensity: 0 },
      callToAction: { action: "transfer_money", friction: "mid" },
      personalization: { level: "targeted", signals: ["thread_injection"] },
      isolation: { tactic: "none", intensity: 0 },
    }),
  },
  {
    name: "platform-credential-soft",
    note: "穏やかな資格情報フィッシング: platform・トリック無し・click_link/high・segmented",
    pattern: seedPattern("platform-credential-soft", {
      urgency: { tactic: "none", intensity: 0 },
      authority: { impersonates: "platform", credibilityTricks: [] },
      incentive: { type: "reward", hook: "refund", intensity: 0 },
      callToAction: { action: "input_credentials", friction: "high" },
      personalization: { level: "segmented", signals: [] },
      isolation: { tactic: "none", intensity: 0 },
    }),
  },
];

// 固定 max-rounds・no-break で1本の seed を回し切る（途中で止めない）。
// investigate → judge → evolve は loop.ts と同一の step。停止ポリシーのみ注入。
async function seedTrajectory(seed: Seed, maxRounds: number): Promise<number[]> {
  const threshold = getDetectionThreshold();
  console.log(`\n----- seed=${seed.name} (threshold=${threshold}, maxRounds=${maxRounds}, no-break) -----`);
  console.log(`  note: ${seed.note}`);
  console.log(
    "round | gen | leverScore | totalScore | bonus | detected | perRoundRecall | missedBy | levers",
  );
  let pattern = seed.pattern;
  const scores: number[] = [];
  const t0 = Date.now();
  for (let round = 1; round <= maxRounds; round++) {
    // ↓↓ loop.ts が呼ぶのと同一の step（本体不変）。
    const report = await investigate({ message: "", levers: pattern.levers });
    const { score } = await judge(pattern.levers, report);
    // ↑↑ ここまで本番と同一。以降は driver の記録と停止ポリシーのみ。
    const detected = score >= threshold;
    const leverScore = computeScore(pattern.levers);
    const m = recordRound([{ kind: "scam", score }], threshold);
    scores.push(score);
    console.log(
      `  ${String(round).padStart(2)}  |  ${pattern.generation}  |    ${String(leverScore).padStart(3)}     |    ${String(score).padStart(3)}     |  +${score - leverScore}  |   ${detected ? "YES" : "no "}   |     ${fmtRecall(m.recall)}      |  ${report.missedBy?.[0] ?? "—"}  | ${leverDigest(pattern)}`,
    );
    // no-break: 検出されても止めない。evolve は detected=true で throw するため、
    // エスカレート継続のため停止ポリシーとして {detected:false} を固定で渡す
    // （evolve 本体・閾値・prompt は不変。missedBy は本物の report 由来をそのまま）。
    pattern = evolve(pattern, { detected: false, missedBy: report.missedBy?.[0] });
  }
  console.log(`  elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return scores;
}

function classifyTrajectory(name: string, scores: number[]): void {
  let monotonicNonDecreasing = true;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] < scores[i - 1]) monotonicNonDecreasing = false;
  }
  const anyDip = scores.some((s, i) => i > 0 && s < scores[i - 1]);
  console.log(`  [${name}] score 系列: [${scores.join(", ")}]`);
  console.log(`  [${name}] 単調非減少(never drops): ${monotonicNonDecreasing} / dip: ${anyDip}`);
}

async function multiSeedTrajectories(maxRounds: number): Promise<void> {
  console.log(`\n========== 複数 seed・no-break トラジェクトリ (maxRounds=${maxRounds}) ==========`);
  console.log("（固定 literal seed × 複数本。停止ポリシーのみ注入、step 本体は loop.ts と同一）");
  const series: Array<{ name: string; scores: number[] }> = [];
  for (const seed of SEEDS) {
    const scores = await seedTrajectory(seed, maxRounds);
    series.push({ name: seed.name, scores });
  }
  console.log("\n--- トラジェクトリ判定（機械的・全 seed） ---");
  for (const s of series) classifyTrajectory(s.name, s.scores);
  const anyDipAcross = series.some((s) => s.scores.some((v, i) => i > 0 && v < s.scores[i - 1]));
  console.log(`  どの seed でも dip が出たか（分布として）: ${anyDipAcross}`);
}

async function main(): Promise<number> {
  console.log("=== PLAN-v2 T2 診断: 素の実走で recall は回復するか ===");
  console.log("（実 Gemini / 防御側は現状=静的 / 攻撃側のみ evolve / 閉ループ無し）");
  const runs = Number(process.env.DIAG_RUNS ?? "0");
  for (let i = 1; i <= runs; i++) {
    await runOnce(`RUN ${i}/${runs}`, 10);
  }
  if (process.env.DIAG_SEEDS !== "0") {
    await multiSeedTrajectories(Number(process.env.DIAG_MAXROUNDS ?? "12"));
  }
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error("diagnose crashed:", e);
    process.exit(2);
  });

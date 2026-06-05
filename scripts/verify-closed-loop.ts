// PLAN-v2 T2 検証: 最小閉ループの実環境エンドツーエンド確認。
// 「すり抜けた型を書き戻すと、次に matchKnownScams が 0→非空 matches を返す」を実証。
//
// 実行: GOOGLE_CLOUD_PROJECT=ai-bridging GOOGLE_CLOUD_LOCATION=us-central1 \
//        DEMO_MODE=true npx tsx scripts/verify-closed-loop.ts
// 要 Vertex ADC + Firestore datastore.user（T1 で付与済み）。
//
// loop.ts の実配線をそのまま使う: generateAttackPattern にだけ subtle seed を注入し、
// persistPattern / investigate / judge / evolve はデフォルト（実 Firestore / 実 Gemini）。
// ＝書き戻しは本番 loop.ts と同一経路で起きる。検証後、書いた doc は削除してコーパスを
// クリーンに戻す（以降の T3/T5 実測を汚さないため）。

process.env.DEMO_MODE = "true";

import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { runLoop } from "@/agents/loop";
import { matchKnownScams } from "@/tools/matchKnownScams";
import { listAttackPatterns, ATTACK_PATTERN_COLLECTION } from "@/lib/firestore";
import type { AttackPattern } from "@/types/attackPattern";

// 診断で score 55（<70）＝すり抜け実績のある subtle BEC（bec-exec-wire）。
function seedLevers(): AttackPattern["levers"] {
  return {
    urgency: { tactic: "none", intensity: 0 },
    authority: { impersonates: "executive", credibilityTricks: ["formal_tone"] },
    incentive: { type: "fear", hook: "penalty", intensity: 0 },
    callToAction: { action: "transfer_money", friction: "mid" },
    personalization: { level: "targeted", signals: ["internal_jargon"] },
    isolation: { tactic: "secrecy", intensity: 1 },
  };
}

function seedPattern(): AttackPattern {
  return {
    id: randomUUID(),
    generation: 1,
    sourceContext: "verify-closed-loop",
    channel: "email",
    levers: seedLevers(),
  };
}

function matchCount(r: Awaited<ReturnType<typeof matchKnownScams>>): string {
  return r.ok ? `${r.matches.length} matches` : `ERROR: ${r.reason}`;
}

async function main(): Promise<number> {
  const levers = seedLevers();
  console.log("=== PLAN-v2 T2 検証: 最小閉ループ（書き戻し→次ラウンドで捕捉）===");

  // BEFORE: コーパス空 → matchKnownScams は 0 matches のはず（V5 初期状態）。
  const before = await matchKnownScams({ levers });
  const beforeCorpus = (await listAttackPatterns()).length;
  console.log(`\n[BEFORE] attackPatterns 件数=${beforeCorpus} / matchKnownScams=${matchCount(before)}`);

  // 実 loop を subtle seed で回す（書き戻しは実 upsertAttackPattern が担う）。
  console.log("\n[RUN] runLoop(subtle seed, maxRounds=3) — すり抜けラウンドで実書き戻し");
  const t0 = Date.now();
  const result = await runLoop({
    agents: { generateAttackPattern: async () => seedPattern() },
    maxRounds: 3,
  });
  const writtenIds = result.rounds
    .filter((r) => !r.result.detected)
    .map((r) => r.pattern.id);
  console.log(
    `  ラウンド結果 detected=${JSON.stringify(result.rounds.map((r) => r.result.detected))} / 書き戻し ${writtenIds.length} 件 / ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  // AFTER: 書き戻し後 → matchKnownScams は非空 matches を返すはず。
  const after = await matchKnownScams({ levers });
  const afterCorpus = (await listAttackPatterns()).length;
  console.log(`\n[AFTER] attackPatterns 件数=${afterCorpus} / matchKnownScams=${matchCount(after)}`);

  const passed =
    before.ok &&
    after.ok &&
    before.matches.length === 0 &&
    after.matches.length > 0 &&
    writtenIds.length > 0;
  console.log(`\n[DoD] 0→非空 matches: ${passed ? "PASS" : "FAIL"}`);

  // CLEANUP: 検証で書いた doc を削除しコーパスを元の空に戻す。
  console.log("\n[CLEANUP] 検証で書いた doc を削除");
  const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  for (const id of writtenIds) {
    await db.collection(ATTACK_PATTERN_COLLECTION).doc(id).delete();
  }
  const post = await matchKnownScams({ levers });
  const postCorpus = (await listAttackPatterns()).length;
  console.log(`  削除後 attackPatterns 件数=${postCorpus} / matchKnownScams=${matchCount(post)}`);

  return passed && postCorpus === beforeCorpus ? 0 : 1;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error("verify-closed-loop crashed:", e);
    process.exit(2);
  });

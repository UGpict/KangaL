// attackPatterns コーパスを self-play で warm する（＝攻撃AIを回してデータ蓄積）。
//
// A-anchor の matchKnownScams / τ 較正は「既知手口コーパス」と照合するため、コーパスが
// 空だと known-scam bonus が常に0で何も測れない。runLoop（生成→調査→判定→進化）を
// LINEAGES 系統 × ROUNDS ラウンド回し、すり抜けた（detected=false）型を upsertAttackPattern
// で永続化する（loop.ts の最小閉ループ）。これはユーザーの当初案「攻撃を定期実行して
// コーパスを育て、防御はそれを照合する」の手動版。
//
// 実行:
//   GOOGLE_CLOUD_PROJECT=<proj> GOOGLE_CLOUD_LOCATION=us-central1 DEMO_MODE=true INTEGRATION=1 \
//   [LINEAGES=3 ROUNDS=5] npx tsx --env-file=.env.local scripts/warmCorpus.ts

process.env.DEMO_MODE = process.env.DEMO_MODE ?? "true";

import { runLoop } from "@/agents/loop";
import { listAttackPatterns } from "@/lib/firestore";

async function main(): Promise<number> {
  if (process.env.INTEGRATION !== "1") {
    console.error("Refusing to run: set INTEGRATION=1（実 Gemini/Firestore に書き込む確認）。");
    return 1;
  }
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    console.error("GOOGLE_CLOUD_PROJECT is required（.env.local を --env-file で渡す）。");
    return 1;
  }
  const lineages = Number(process.env.LINEAGES ?? "3");
  const rounds = Number(process.env.ROUNDS ?? "5");

  const before = (await listAttackPatterns()).length;
  console.log(`=== warmCorpus: self-play ${lineages} 系統 × maxRounds=${rounds} ===`);
  console.log(`  開始時 corpus=${before} docs`);

  for (let i = 0; i < lineages; i++) {
    const r = await runLoop({ maxRounds: rounds });
    console.log(
      `  系統 ${i + 1}: rounds=${r.totalRounds} / finalDetected=${r.finalDetected}`,
    );
  }

  const after = (await listAttackPatterns()).length;
  console.log(`\n  終了時 corpus=${after} docs（+${after - before}）`);
  if (after === before) {
    console.log(
      "  ※ 増えていない＝全型が早期に検知され永続化されなかった可能性。ROUNDS/LINEAGES を増やすか、\n" +
        "    defender が強すぎないか（すり抜けが起きるか）を確認。",
    );
  } else {
    console.log("  → τ 較正（scripts/calibrateKnownScamThreshold.ts）を再走できます。");
  }
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error("warmCorpus crashed:", e);
    process.exit(2);
  });

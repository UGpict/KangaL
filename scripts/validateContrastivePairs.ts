// 盲変異 対照ペアの鏡像汚染ガード LIVE ランナー（二重ゲートの (i) を実行）。
//
// 各ペアの base/mutated を analyzeStructure で K 回ずつ抽出し、多数決 → 純粋ガード
// validateContrastivePair で「target レバーだけが動き他は不変」を確認する。多数決なのは
// analyzeStructure が非決定（probeMajorityVote の一件）で単発だと偶発ドリフトで落ちるため。
//
// 出力の valid_but_fragile は「今回は通ったが mode が僅差＝不安定」＝K を増やして再確認せよ、
// の合図。contamination / target_not_moved / no_lever_moved は構成のやり直し。
//
// 実行:
//   GOOGLE_CLOUD_PROJECT=<proj> GOOGLE_CLOUD_LOCATION=us-central1 INTEGRATION=1 \
//   [K=7] npx tsx --env-file=.env.local scripts/validateContrastivePairs.ts

import { analyzeStructure } from "@/agents/analyzeStructure";
import { CONTRASTIVE_PAIRS } from "@/data/contrastivePairs";
import {
  validateContrastivePair,
  type Draw,
} from "@/lib/contrastivePair";

async function drawK(text: string, k: number): Promise<Draw[]> {
  const out: Draw[] = [];
  for (let i = 0; i < k; i++) {
    const r = await analyzeStructure(text);
    out.push({ levers: r.levers, degraded: r.degraded });
  }
  return out;
}

async function main(): Promise<number> {
  if (process.env.INTEGRATION !== "1") {
    console.error("Refusing to run: set INTEGRATION=1（実 Gemini を叩く確認）。");
    return 1;
  }
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    console.error("GOOGLE_CLOUD_PROJECT is required（.env.local を --env-file で渡す）。");
    return 1;
  }
  if (CONTRASTIVE_PAIRS.length === 0) {
    console.error(
      "CONTRASTIVE_PAIRS が空。src/data/contrastivePairs.ts に盲変異ペアを構成して投入してから再実行。",
    );
    return 1;
  }
  const k = Number(process.env.K ?? "7");

  console.log(`=== 対照ペア 鏡像汚染ガード（K=${k}/文, ${CONTRASTIVE_PAIRS.length} ペア）===`);

  let validCount = 0;
  const failures: string[] = [];
  const fragilePasses: string[] = [];

  for (const pair of CONTRASTIVE_PAIRS) {
    const baseDraws = await drawK(pair.base.text, k);
    const mutatedDraws = await drawK(pair.mutated.text, k);
    const r = validateContrastivePair({
      baseDraws,
      mutatedDraws,
      targetLever: pair.targetLever,
    });

    const tag = r.valid ? (r.fragile.length > 0 ? "△ valid(fragile)" : "✓ valid") : "✗ invalid";
    console.log(
      `\n[${pair.id}] target=${pair.targetLever} → ${tag}\n  ${r.reason}` +
        `\n  moved=[${r.moved.join(",")}] fragile=[${r.fragile.join(",")}]`,
    );

    if (r.valid) {
      validCount += 1;
      if (r.fragile.length > 0) fragilePasses.push(pair.id);
    } else {
      failures.push(`${pair.id}: ${r.reason}`);
    }
  }

  console.log(`\n════════════ 集計 ════════════`);
  console.log(`  valid=${validCount}/${CONTRASTIVE_PAIRS.length}（うち fragile=${fragilePasses.length}）`);
  if (fragilePasses.length > 0) {
    console.log(`  fragile（K を増やして再確認）: ${fragilePasses.join(", ")}`);
  }
  if (failures.length > 0) {
    console.log(`  invalid（構成やり直し）:`);
    for (const f of failures) console.log(`    - ${f}`);
    return 1;
  }
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error("validateContrastivePairs crashed:", e);
    process.exit(2);
  });

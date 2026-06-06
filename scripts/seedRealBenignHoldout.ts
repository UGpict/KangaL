// Seeder for the 柱2 道A external real-benign holdout (評価専用・攻撃側到達不可).
// Run with:  npm run seed:holdout-benign   (requires INTEGRATION=1 + ADC + GOOGLE_CLOUD_PROJECT)
//
// Idempotent via `set` (upsert). 各 item の provenance と benignDifficulty を投入前に
// 検証し、source / collectedAt が欠けるもの・帯ラベル不正のものは書かない。
// 1件の失敗で全体を止めず、最後に ok/fail を集計し失敗があれば非ゼロ終了。
import { REAL_BENIGN_HOLDOUT } from "@/data/realBenignHoldout";
import { upsertRealBenignSample } from "@/lib/realBenignHoldout";

function validationError(sample: {
  id: string;
  benignDifficulty?: unknown;
  messageBody?: unknown;
  provenance?: unknown;
}): string | null {
  if (typeof sample.messageBody !== "string" || sample.messageBody.trim() === "")
    return "messageBody が空です（捏造禁止＝本物のみ）";
  if (
    sample.benignDifficulty !== "easy" &&
    sample.benignDifficulty !== "effective"
  )
    return "benignDifficulty は easy / effective のいずれか";
  const p = sample.provenance as
    | { source?: unknown; collectedAt?: unknown }
    | undefined;
  if (!p || typeof p !== "object") return "provenance がありません";
  if (typeof p.source !== "string" || p.source.trim() === "")
    return "provenance.source（収集元）が空です";
  if (typeof p.collectedAt !== "string" || p.collectedAt.trim() === "")
    return "provenance.collectedAt（収集日）が空です";
  return null;
}

async function main(): Promise<number> {
  if (process.env.INTEGRATION !== "1") {
    console.error(
      "Refusing to run: set INTEGRATION=1 to confirm you want to write to Firestore.",
    );
    return 1;
  }
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    console.error("GOOGLE_CLOUD_PROJECT is required.");
    return 1;
  }
  if (REAL_BENIGN_HOLDOUT.length === 0) {
    console.error(
      "Refusing to run: REAL_BENIGN_HOLDOUT is empty. 実物 benign を provenance 付きで\n" +
        "src/data/realBenignHoldout.ts に投入してから再実行してください（捏造禁止）。",
    );
    return 1;
  }

  const byBand = REAL_BENIGN_HOLDOUT.reduce<Record<string, number>>((acc, s) => {
    acc[s.benignDifficulty] = (acc[s.benignDifficulty] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `Seeding ${REAL_BENIGN_HOLDOUT.length} real-benign holdout samples to ` +
      `project=${process.env.GOOGLE_CLOUD_PROJECT}...\n` +
      `  帯内訳: ${Object.entries(byBand).map(([b, n]) => `${b}:${n}`).join(" / ")}`,
  );
  if (!byBand.effective) {
    console.log(
      "  ※ effective 帯が 0 件です。商用帯 stressor が無い状態＝床下げの FP 危険は\n" +
        "    まだ測れません（easy control のみ＝安全性下界の確認まで）。",
    );
  }

  let ok = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const sample of REAL_BENIGN_HOLDOUT) {
    const err = validationError(sample);
    if (err) {
      failures.push({ id: sample.id, error: err });
      console.log(`  ✗ ${sample.id}: ${err}`);
      continue;
    }
    try {
      await upsertRealBenignSample(sample.id, {
        kind: sample.kind,
        messageBody: sample.messageBody,
        benignDifficulty: sample.benignDifficulty,
        provenance: sample.provenance,
      });
      ok += 1;
      console.log(
        `  ✓ ${sample.id}  [${sample.benignDifficulty}/${sample.provenance.source}]`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ id: sample.id, error: msg });
      console.log(`  ✗ ${sample.id}: ${msg}`);
    }
  }

  console.log(
    `\nDone. ok=${ok}, fail=${failures.length}, total=${REAL_BENIGN_HOLDOUT.length}`,
  );
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.id}: ${f.error}`);
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("Unexpected error:", e);
    process.exit(1);
  });

// Seeder for the 柱2 external real-scam holdout (評価専用・攻撃側到達不可).
// Run with:  npm run seed:holdout   (requires INTEGRATION=1 + ADC + GOOGLE_CLOUD_PROJECT)
//
// Idempotent via `set` (upsert). 各 item の provenance を投入前に検証し、source /
// collectedAt が欠けるものは書かない（出自不明の実物は holdout を汚す）。
// 1件の失敗で全体を止めず、最後に ok/fail を集計し失敗があれば非ゼロ終了。
import { REAL_SCAM_HOLDOUT } from "@/data/realScamHoldout";
import { upsertRealScamSample } from "@/lib/realScamHoldout";

function provenanceError(sample: { id: string; provenance?: unknown }): string | null {
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
  if (REAL_SCAM_HOLDOUT.length === 0) {
    console.error(
      "Refusing to run: REAL_SCAM_HOLDOUT is empty. 実物 scam を provenance 付きで\n" +
        "src/data/realScamHoldout.ts に投入してから再実行してください（捏造禁止）。",
    );
    return 1;
  }

  console.log(
    `Seeding ${REAL_SCAM_HOLDOUT.length} real-scam holdout samples to project=${process.env.GOOGLE_CLOUD_PROJECT}...`,
  );

  let ok = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const sample of REAL_SCAM_HOLDOUT) {
    const provErr = provenanceError(sample);
    if (provErr) {
      failures.push({ id: sample.id, error: provErr });
      console.log(`  ✗ ${sample.id}: ${provErr}`);
      continue;
    }
    try {
      await upsertRealScamSample(sample.id, {
        kind: sample.kind,
        messageBody: sample.messageBody,
        provenance: sample.provenance,
      });
      ok += 1;
      console.log(`  ✓ ${sample.id}  [${sample.provenance.source}]`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ id: sample.id, error: msg });
      console.log(`  ✗ ${sample.id}: ${msg}`);
    }
  }

  console.log(
    `\nDone. ok=${ok}, fail=${failures.length}, total=${REAL_SCAM_HOLDOUT.length}`,
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

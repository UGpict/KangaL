// Seeder for the FPR-denominator benign samples (§7).
// Run with:  npm run seed:benign   (requires INTEGRATION=1 + ADC + GOOGLE_CLOUD_PROJECT)
//
// Idempotent via `set` (upsert). Errors per item are caught so one bad write
// does not abort the rest; a final summary reports ok/fail counts and the
// process exits non-zero if any item failed.
import { BENIGN_SAMPLES } from "@/data/benignSamples";
import { upsertBenignSample } from "@/lib/firestore";

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

  console.log(
    `Seeding ${BENIGN_SAMPLES.length} benign samples to project=${process.env.GOOGLE_CLOUD_PROJECT}...`,
  );

  let ok = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const sample of BENIGN_SAMPLES) {
    try {
      await upsertBenignSample(sample.id, {
        kind: sample.kind,
        messageBody: sample.messageBody,
      });
      ok += 1;
      console.log(`  ✓ ${sample.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ id: sample.id, error: msg });
      console.log(`  ✗ ${sample.id}: ${msg}`);
    }
  }

  console.log(
    `\nDone. ok=${ok}, fail=${failures.length}, total=${BENIGN_SAMPLES.length}`,
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

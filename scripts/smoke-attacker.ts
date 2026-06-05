// Manual smoke test for the attack agent (Task 7-V3). NOT part of CI.
// Runs one turn of the 攻防 loop by hand: recon → gen1 → evolve → gen2,
// then proves the detected=true contract throws.
//
// Run with:  npx tsx scripts/smoke-attacker.ts
// Requires Vertex AI access (GOOGLE_CLOUD_PROJECT + ADC) for a real gen1.
// Without credentials, generateAttackPattern degrades to a "fallback-seed"
// pattern — the structural checks still run, but the "not fallback-seed"
// criterion will report NG (expected for an uncredentialed run).
//
// Contract note: DetectionFeedback.missedBy is a single string (the tool that
// was blind), not an array — see attacker.ts. The smoke uses "urlReputation".
import { reconPublicAlerts } from "@/tools/reconPublicAlerts";
import {
  generateAttackPattern,
  evolve,
  type DetectionFeedback,
} from "@/agents/attacker";
import type { AttackPattern } from "@/types/attackPattern";

type DiffEntry = { path: string; before: unknown; after: unknown };

function deepDiff(
  a: unknown,
  b: unknown,
  path: string,
  out: DiffEntry[],
): void {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      deepDiff(a[k], b[k], path ? `${path}.${k}` : k, out);
    }
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push({ path, before: a, after: b });
  }
}

function check(label: string, ok: boolean): boolean {
  console.log(`  [${ok ? "OK" : "NG"}] ${label}`);
  return ok;
}

async function main(): Promise<number> {
  console.log("=== Task 7-V3: attacker smoke test ===\n");

  // 1. recon (default fetcher = static snapshot)
  const recon = await reconPublicAlerts();
  console.log("--- 1. reconPublicAlerts (default fetcher) ---");
  if (recon.ok) {
    for (const t of recon.trends) {
      console.log(`  [${t.category}] ${t.date}  ${t.title}`);
    }
  } else {
    console.log(`  recon failed: ${recon.reason}`);
  }
  console.log();

  // 2. gen1
  const gen1 = await generateAttackPattern();
  console.log("--- 2. generateAttackPattern (gen1) ---");
  console.log(`  id:            ${gen1.id}`);
  console.log(`  generation:    ${gen1.generation}`);
  console.log(`  sourceContext: ${gen1.sourceContext}`);
  console.log(`  channel:       ${gen1.channel}`);
  console.log("  levers:");
  console.log(indent(JSON.stringify(gen1.levers, null, 2), 4));
  console.log();

  // 3 / 4. build slipped-through feedback and evolve to gen2
  const feedback: DetectionFeedback = {
    detected: false,
    missedBy: "urlReputation",
  };
  const gen2 = evolve(gen1, feedback);
  console.log("--- 3. evolve (detected=false, missedBy=urlReputation) → gen2 ---");
  console.log(`  id:            ${gen2.id}`);
  console.log(`  parentId:      ${gen2.parentId}`);
  console.log(`  generation:    ${gen2.generation}`);
  console.log(`  channel:       ${gen2.channel}`);
  console.log("  levers:");
  console.log(indent(JSON.stringify(gen2.levers, null, 2), 4));
  console.log();

  // 5. diff gen1 → gen2
  const diff: DiffEntry[] = [];
  deepDiff(
    { channel: gen1.channel, levers: gen1.levers },
    { channel: gen2.channel, levers: gen2.levers },
    "",
    diff,
  );
  console.log("--- 4. gen1 → gen2 changed levers ---");
  if (diff.length === 0) {
    console.log("  (no change)");
  } else {
    for (const d of diff) {
      console.log(
        `  ${d.path}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`,
      );
    }
  }
  console.log();

  // 6. detected=true must throw
  console.log("--- 5. evolve (detected=true) must throw ---");
  let threw = false;
  try {
    evolve(gen1, { detected: true });
    console.log("  did NOT throw (unexpected)");
  } catch (e) {
    threw = true;
    console.log(`  threw as expected: ${(e as Error).message}`);
  }
  console.log();

  // 7. pass criteria
  console.log("--- 合格基準 ---");
  const urlChanged =
    JSON.stringify(gen1.levers.authority.credibilityTricks) !==
      JSON.stringify(gen2.levers.authority.credibilityTricks) ||
    gen1.channel !== gen2.channel;
  const results = [
    check("gen1 の 6レバーが全て埋まっている", Object.keys(gen1.levers).length === 6),
    check("gen2 の generation が 2", gen2.generation === 2),
    check("gen2.parentId === gen1.id", gen2.parentId === gen1.id),
    check(
      "urlReputation で channel か credibilityTrick が変化",
      urlChanged,
    ),
    check("detected=true で throw", threw),
    check(
      'sourceContext が "fallback-seed" でない（Gemini 正常時）',
      gen1.sourceContext !== "fallback-seed",
    ),
  ];
  console.log();

  const allOk = results.every(Boolean);
  console.log(allOk ? "RESULT: ALL OK" : "RESULT: see NG above");
  if (gen1.sourceContext === "fallback-seed") {
    console.log(
      "NOTE: gen1 は fallback-seed。Vertex 認証が無い環境では Gemini 呼び出しが失敗し degraded になります（最後の基準のみ要 credentialed run）。",
    );
  }
  return allOk ? 0 : 1;
}

function indent(s: string, n: number): string {
  const pad = " ".repeat(n);
  return s
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("smoke test crashed:", e);
    process.exit(2);
  });

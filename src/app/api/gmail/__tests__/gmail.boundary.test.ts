import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

// Structural guard for the Gmail read path (G2). Fetched mail must be a
// read-only pass-through: it is shaped for /api/judge and returned to the
// client, never written into any persistence/learning layer. If a gmail route
// ever reaches corpusWriter / holdout / feedbackWriter / firestore through its
// import graph, that would mean inbox content could leak into the corpus or
// userVerdicts — exactly what this test forbids.
//
// NOTE: the existing feedbackWriter.boundary.test.ts only walks from judge.ts /
// attacker.ts, so it does NOT cover the gmail entry points. This test is the
// dedicated net for them (walker logic mirrors that file).

const REPO_ROOT = process.cwd();
const SRC = resolve(REPO_ROOT, "src");

const ENTRIES = {
  "messages/route.ts": resolve(SRC, "app", "api", "gmail", "messages", "route.ts"),
  "messages/[id]/route.ts": resolve(
    SRC,
    "app",
    "api",
    "gmail",
    "messages",
    "[id]",
    "route.ts",
  ),
};

const FORBIDDEN = /corpuswriter|holdout|feedbackwriter|firestore/i;

const SPECIFIER_PATTERNS = [
  /\bimport\s+(?:type\s+)?[^"';]*?from\s*["']([^"']+)["']/g,
  /\bexport\s+(?:type\s+)?[^"';]*?from\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s+["']([^"']+)["']/g,
];

function extractSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const pat of SPECIFIER_PATTERNS) {
    for (const m of source.matchAll(pat)) out.push(m[1]);
  }
  return out;
}

function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../"))
    base = resolve(dirname(fromFile), spec);
  else return null;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && !c.endsWith("/")) return c;
  }
  return null;
}

type Graph = { files: Set<string>; specifiers: Set<string> };

function walk(entry: string): Graph {
  const files = new Set<string>();
  const specifiers = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const spec of extractSpecifiers(source)) {
      specifiers.add(spec);
      const local = resolveLocal(spec, file);
      if (local && !files.has(local)) stack.push(local);
    }
  }
  return { files, specifiers };
}

describe("gmail 読み取りパスの隔離: 永続/学習層へ到達不能", () => {
  for (const [name, entry] of Object.entries(ENTRIES)) {
    const graph = walk(entry);

    it(`${name} の import グラフは corpus/holdout/feedback/firestore に到達しない`, () => {
      const offending = [...graph.specifiers].filter((s) => FORBIDDEN.test(s));
      expect(offending).toEqual([]);
      for (const f of graph.files) {
        expect(FORBIDDEN.test(f)).toBe(false);
      }
    });

    it(`${name}: ウォーカが実際にグラフを辿れている（健全性）`, () => {
      expect(graph.files.has(entry)).toBe(true);
      expect(graph.files.size).toBeGreaterThan(2);
    });
  }
});

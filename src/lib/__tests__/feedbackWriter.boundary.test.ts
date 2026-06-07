import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

// feedbackWriter（userVerdicts への書き込み層）の隔離を *構造で* 守る境界テスト。
//
// ユーザーの逃げ道（報告／安全だと判断）の永続は、判定パス（judge.ts）とも攻撃側
// （attacker.ts）とも無関係でなければならない。万一どちらかの import グラフが
// feedbackWriter に到達したら、それは「判定/学習パスが userVerdicts へ書ける」状態
// であり、道B 不変条件A（reader/writer 分離・attacker の永続層非依存）を侵す。
//
// 手段は attacker.boundary.test.ts と同じ: 各エントリからローカル import を再帰的に
// たどり、到達集合に feedbackWriter が現れたら失敗。

const REPO_ROOT = process.cwd();
const SRC = resolve(REPO_ROOT, "src");
const FEEDBACK_WRITER = resolve(SRC, "lib", "feedbackWriter.ts");

const ENTRIES = {
  "judge.ts": resolve(SRC, "agents", "judge.ts"),
  "attacker.ts": resolve(SRC, "agents", "attacker.ts"),
};

const FORBIDDEN = /feedbackwriter/i;

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

describe("feedbackWriter 隔離: judge / attacker から到達不能", () => {
  for (const [name, entry] of Object.entries(ENTRIES)) {
    const graph = walk(entry);

    it(`${name} の import グラフは feedbackWriter に到達しない`, () => {
      expect(graph.files.has(FEEDBACK_WRITER)).toBe(false);
      const offending = [...graph.specifiers].filter((s) => FORBIDDEN.test(s));
      expect(offending).toEqual([]);
    });

    it(`${name}: ウォーカが実際にグラフを辿れている（健全性）`, () => {
      expect(graph.files.has(entry)).toBe(true);
      expect(graph.files.size).toBeGreaterThan(2);
    });
  }
});

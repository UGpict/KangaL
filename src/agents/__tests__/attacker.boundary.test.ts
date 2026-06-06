import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

// 柱2 不変条件 A の境界テスト（構造で守る、レビューや規律に頼らない）。
//
// 実物詐欺ホールドアウトは「評価専用隔離」: 攻撃側 evolve に絶対に食わせない。
// それを保証する最終防壁は import グラフの分離 ——
//   攻撃側エントリ（attacker.ts）から到達可能なモジュール集合に、
//   firestore も holdout reader も *一切現れない*。
// これが成り立てば、attacker は永続化層にも実物コレクションにも構造的に触れない
// （V3 の「永続化は defender 側 loop が行い attacker.ts は firestore 非依存」を
// 一文の規約でなく到達不能性として固定する）。
//
// 手段: attacker.ts からローカル import を再帰的にたどり、到達した全モジュールの
// パスと、グラフ中の全 import 指定子を集める。禁止パターンに当たれば即失敗。
// 将来 holdout reader（例 realScamHoldout.ts）を足したとき、誰かが誤って
// 攻撃側グラフに繋いだら、このテストが落ちる。

const REPO_ROOT = process.cwd();
const SRC = resolve(REPO_ROOT, "src");
const ENTRY = resolve(SRC, "agents", "attacker.ts");

// 攻撃側に現れてはならない指定子・モジュール（大小無視）。
// - firestore: 永続化層（upsert/list、実物コレクションへの唯一の口）。
// - holdout / realScamHoldout / realBenignHoldout: 実物評価データ（scam・benign）の reader。
//   /holdout/ で両者とも捕まるが、reader 名を明示列挙して意図を残す（誤改名への保険）。
const FORBIDDEN = /firestore|holdout|realscamholdout|realbenignholdout/i;

const SPECIFIER_PATTERNS = [
  /\bimport\s+(?:type\s+)?[^"';]*?from\s*["']([^"']+)["']/g,
  /\bexport\s+(?:type\s+)?[^"';]*?from\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import
  /\bimport\s+["']([^"']+)["']/g, // side-effect import
];

function extractSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const pat of SPECIFIER_PATTERNS) {
    for (const m of source.matchAll(pat)) out.push(m[1]);
  }
  return out;
}

// ローカル指定子（@/ または ./ ../）のみ実ファイルに解決する。bare（@google/genai,
// node:crypto 等）は外部なので追わない。解決できなければ null。
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
    if (existsSync(c) && !c.endsWith("/") && isFile(c)) return c;
  }
  return null;
}

function isFile(p: string): boolean {
  try {
    return readFileSync(p) != null;
  } catch {
    return false;
  }
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

describe("不変条件 A: 攻撃側 import グラフは firestore / holdout reader に到達しない", () => {
  const graph = walk(ENTRY);

  it("attacker.ts から到達するモジュールに firestore / holdout が無い", () => {
    const offending = [...graph.files].filter((f) => FORBIDDEN.test(f));
    expect(offending).toEqual([]);
  });

  it("グラフ中のどの import 指定子も firestore / holdout を指さない", () => {
    const offending = [...graph.specifiers].filter((s) => FORBIDDEN.test(s));
    expect(offending).toEqual([]);
  });

  it("firestore モジュール自体が到達集合に含まれない（明示）", () => {
    const firestoreModule = resolve(SRC, "lib", "firestore.ts");
    expect(graph.files.has(firestoreModule)).toBe(false);
  });

  it("ウォーカが実際にグラフを辿れている（健全性: エントリ＋複数モジュール）", () => {
    // 0/1 件しか辿れていないなら解決ロジックが壊れていて上の green は無意味。
    expect(graph.files.has(ENTRY)).toBe(true);
    expect(graph.files.size).toBeGreaterThan(2);
  });
});

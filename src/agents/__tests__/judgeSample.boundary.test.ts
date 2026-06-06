import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

// 柱2 不変条件A の *書き込み側* 境界テスト（attacker.boundary.test.ts の対）。
//
// 守る因果: BEFORE/AFTER は「self-play warm が実物 holdout への汎化を上げた」を言う
// 設計で、成立条件は holdout が AFTER 計測まで corpus にとって unseen であり続けること。
// もし judge/eval パスが判定の過程で holdout 由来のレバーを corpus（warm が読む
// attackPatterns）へ書けば、AFTER warm はその漏れた signal を学習材料にする——AFTER
// recall は汎化でなく漏洩で上がり、しかも dependsOnKnownScam=false のサブセットにこそ
// 効く（driver 分割が暴こうとした「暗記を汎化に偽装」を計器自身が製造する）。だから
// これはレビュー規律でなく構造ガードに値する。
//
// 守り方（能力分離をモジュール境界で）: read-only の判定/評価エントリ（judgeSample.ts）
// から到達する import グラフに、コーパス *writer*（corpusWriter.ts）が一切現れないこと。
// reader（firestore.ts の listAttackPatterns 等）への到達は正当なので許す——writer だけを
// 別モジュールに隔離してあるから、file 単位の到達性で読み/書きを分離できる。
//
// なぜ file 単位の import グラフで足りるか: warm（runLoop, 書き込みあり）は別モジュール
// loop.ts に置き、judgeSample.ts は loop.ts を import しない（依存は loop→judgeSample の
// 一方向）。よって judgeSample.ts の到達集合に corpusWriter は構造的に入らない。
//
// 禁止集合の導出原則（名前ハードコード回避）: 禁止すべきは「upsertAttackPattern という
// 名前」ではなく「warm が後で読むものへの書き込み」全部。warm の read 集合は今
// attackPatterns コーパスのみ＝その writer モジュール corpusWriter を禁止する。将来 warm
// の read 集合が増えたら（例: judgeSample が判定キャッシュを書き warm が読む）、その
// writer も隔離モジュールへ出し下の FORBIDDEN に足すこと。
//
// 残る穴（正直な但し書き）: judgeSampleDetailed は deps.investigate を注入できる。注入
// 関数の中身は型で縛れず、理論上は注入版が corpusWriter を自力 import して書ける。その
// 経路は本テスト（既定 investigate の到達集合を歩く）の静的スコープ外。完全に塞ぐには
// corpus を reader 型ハンドルで引数渡しする thread が要る＝現状の侵襲度に見合わず未実施。

const REPO_ROOT = process.cwd();
const SRC = resolve(REPO_ROOT, "src");
const ENTRY = resolve(SRC, "agents", "judgeSample.ts");

// judge/eval パスに現れてはならない指定子・モジュール（大小無視）。
// - corpusWriter / corpus-writer: attackPatterns コーパスへの唯一の writer。
// - upsertAttackPattern: 念のため writer シンボル名そのものも拾う（隔離前への退行検知）。
const FORBIDDEN = /corpuswriter|corpus-writer|upsertattackpattern/i;

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

describe("不変条件A: judge/eval パスは corpus writer に到達しない（漏洩封じ）", () => {
  const graph = walk(ENTRY);

  it("judgeSample.ts から到達するモジュールに corpus writer が無い", () => {
    const offending = [...graph.files].filter((f) => FORBIDDEN.test(f));
    expect(offending).toEqual([]);
  });

  it("グラフ中のどの import 指定子も corpus writer を指さない", () => {
    const offending = [...graph.specifiers].filter((s) => FORBIDDEN.test(s));
    expect(offending).toEqual([]);
  });

  it("corpusWriter モジュール自体が到達集合に含まれない（明示）", () => {
    const writerModule = resolve(SRC, "lib", "corpusWriter.ts");
    expect(graph.files.has(writerModule)).toBe(false);
  });

  it("reader（firestore.ts）への到達は許される＝判定は corpus を読める（健全性）", () => {
    // judge/eval は matchKnownScams 経由で listAttackPatterns を読む。reader 到達は
    // 正当。これが落ちるなら walker が壊れているか配線が変わった合図。
    const firestoreModule = resolve(SRC, "lib", "firestore.ts");
    expect(graph.files.has(firestoreModule)).toBe(true);
  });

  it("ウォーカが実際にグラフを辿れている（健全性: エントリ＋複数モジュール）", () => {
    expect(graph.files.has(ENTRY)).toBe(true);
    expect(graph.files.size).toBeGreaterThan(2);
  });
});

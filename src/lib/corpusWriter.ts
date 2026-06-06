import { Firestore } from "@google-cloud/firestore";
import { ATTACK_PATTERN_COLLECTION } from "@/lib/firestore";
import type { AttackPattern } from "@/types/attackPattern";

// 柱2 不変条件A の「書き込み能力」隔離層。
//
// attackPatterns コーパスへの *唯一の writer*（upsertAttackPattern）をここに分離する。
// 理由は能力分離（capability separation）を *モジュール境界* で表現するため:
//  - 防御側の評価/判定パス（src/agents/judgeSample.ts）は warm が後で読む集合
//    （= matchKnownScams が読む attackPatterns コーパス）に *書いてはならない*。
//    書けば AFTER warm がその漏れたレバーを学習材料にし、BEFORE→AFTER の伸びが
//    「汎化」でなく「漏洩」になる（しかも dependsOnKnownScam=false 側にこそ効く＝
//    driver 分割が暴こうとした現象を計器自身が製造する）。
//  - reader（listAttackPatterns 等）は firestore.ts に残し、判定パスはそちらを
//    自由に読める。writer だけを別モジュールに出すことで、judgeSample.ts の
//    import グラフが *この modules に到達しない* ことを境界テストで静的に保証できる
//    （judgeSample.boundary.test.ts）。これは realScamHoldout.ts と同じ隔離作法。
//
// 唯一の正当な importer は warm ループ（src/agents/loop.ts の DEFAULT_AGENTS.
// persistPattern）。すり抜けた型をコーパスへ書き戻すのは防御側 loop の責務であり、
// 判定/評価パスではない。
//
// 注意（禁止集合の導出原則）: 禁止すべきは「upsertAttackPattern という名前」ではなく
// 「warm が後で読むものへの書き込み」全部。将来 warm の read 集合が増えたら（例:
// judgeSample が性能のため判定キャッシュを書き warm がそれを読む）、その writer も
// 同様にこの隔離モジュール群へ出し、境界テストの禁止集合へ追加すること。
export async function upsertAttackPattern(pattern: AttackPattern): Promise<void> {
  const doc: Record<string, unknown> = {
    generation: pattern.generation,
    sourceContext: pattern.sourceContext,
    channel: pattern.channel,
    levers: pattern.levers,
  };
  if (pattern.parentId !== undefined) doc.parentId = pattern.parentId;
  await getDb().collection(ATTACK_PATTERN_COLLECTION).doc(pattern.id).set(doc);
}

// 評価専用層（realScamHoldout.ts）と同方針で独立クライアントを持つ。
let cachedDb: Firestore | null = null;

export function __resetForTests(): void {
  cachedDb = null;
}

function getDb(): Firestore {
  if (cachedDb) return cachedDb;
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT env var is required to talk to Firestore.",
    );
  }
  cachedDb = new Firestore({ projectId: project });
  return cachedDb;
}

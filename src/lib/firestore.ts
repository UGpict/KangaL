import { Firestore } from "@google-cloud/firestore";
import type {
  AttackPattern,
  BenignSample,
  ScamSample,
} from "@/types/attackPattern";

export const BENIGN_COLLECTION = "benignSamples";
export const SCAM_SAMPLE_COLLECTION = "scamSamples";
export const ATTACK_PATTERN_COLLECTION = "attackPatterns";

let cachedDb: Firestore | null = null;

// Test-only escape hatch — Vitest resets module state per file, but if tests
// share state within one file they can call this to force a fresh client.
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

export async function upsertBenignSample(
  id: string,
  sample: BenignSample,
): Promise<void> {
  await getDb().collection(BENIGN_COLLECTION).doc(id).set({
    kind: sample.kind,
    messageBody: sample.messageBody,
  });
}

// 最小閉ループ (PLAN-v2 T2/V2): defender 経路がすり抜けた AttackPattern を
// matchKnownScams が読む attackPatterns コレクションへ書き戻すための writer。
// 道B invariant: 保存するのは AttackPattern スキーマ（レバー＋channel）のみで、
// 完成した詐欺文は一切持たない（引数型が AttackPattern であることがそれを保証する）。
// id は doc id に使い、フィールドには含めない（listAttackPatterns が d.id で復元）。
// detectionResult（その回限りの検出状態）はコーパスの素性に不要なので保存しない。
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

export async function listBenignSamples(): Promise<
  Array<{ id: string } & BenignSample>
> {
  const snap = await getDb().collection(BENIGN_COLLECTION).get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      kind: "benign" as const,
      messageBody: typeof data.messageBody === "string" ? data.messageBody : "",
    };
  });
}

// Scam corpus helpers. Used by matchKnownScams (Chunk 2) and by the attack
// agent (Task 8 onward). For Chunk 2 the collections are empty, so callers
// will get empty arrays.
export async function listScamSamples(): Promise<
  Array<{ id: string } & ScamSample>
> {
  const snap = await getDb().collection(SCAM_SAMPLE_COLLECTION).get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      kind: "scam" as const,
      messageBody: typeof data.messageBody === "string" ? data.messageBody : "",
    };
  });
}

export async function listAttackPatterns(): Promise<AttackPattern[]> {
  const snap = await getDb().collection(ATTACK_PATTERN_COLLECTION).get();
  return snap.docs.map((d) => {
    const data = d.data() as AttackPattern;
    // Trust that the writer (Task 8 attack agent) shaped the doc correctly.
    // Defensive parsing would be heavy here and obscure shape drift — let it
    // surface as a downstream type error instead.
    return { ...data, id: d.id };
  });
}

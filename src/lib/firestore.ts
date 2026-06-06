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

// 道B invariant の writer（upsertAttackPattern）は src/lib/corpusWriter.ts へ分離した。
// 理由は「コーパスへの書き込み能力」を judge/eval パスから *モジュール境界で* 切り離し、
// 不変条件A を judgeSample.boundary.test.ts で静的に守るため。firestore.ts は reader のみ。

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

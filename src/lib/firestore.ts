import { Firestore } from "@google-cloud/firestore";
import type { BenignSample } from "@/types/attackPattern";

export const BENIGN_COLLECTION = "benignSamples";

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

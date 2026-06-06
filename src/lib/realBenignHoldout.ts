import { Firestore } from "@google-cloud/firestore";
import type {
  BenignDifficulty,
  RealBenignSample,
  SampleProvenance,
} from "@/types/attackPattern";

// 柱2 道A: 外部実物「良性」ホールドアウトの評価専用アクセス層。
//
// realScamHoldout と *別モジュール・別コレクション* に置く。scam-named ファイルに
// benign を混ぜると「名が体を表さない（doc-lie）」＝後で読む人を欺く。物理分離する。
//
// 不変条件A（attacker.boundary.test.ts）の最終防壁を効かせるため、このモジュールは
// 攻撃側 import グラフから到達してはならない。ファイル名・コレクション名・公開シンボルに
// 必ず "holdout" を含めることで、誤って攻撃側に繋がれた瞬間に境界テストの禁止正規表現
// が import 指定子で確実に捕捉する。
export const REAL_BENIGN_HOLDOUT_COLLECTION = "realBenignHoldout";

// 評価専用に独立した Firestore クライアント（firestore.ts / realScamHoldout.ts とも共有しない）。
let cachedDb: Firestore | null = null;

// Test-only escape hatch。
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

function normalizeDifficulty(v: unknown): BenignDifficulty {
  return v === "effective" ? "effective" : "easy";
}

export async function upsertRealBenignSample(
  id: string,
  sample: RealBenignSample,
): Promise<void> {
  await getDb()
    .collection(REAL_BENIGN_HOLDOUT_COLLECTION)
    .doc(id)
    .set({
      kind: sample.kind,
      messageBody: sample.messageBody,
      benignDifficulty: sample.benignDifficulty,
      provenance: sample.provenance,
    });
}

export async function listRealBenignHoldout(): Promise<
  Array<{ id: string } & RealBenignSample>
> {
  const snap = await getDb().collection(REAL_BENIGN_HOLDOUT_COLLECTION).get();
  return snap.docs.map((d) => {
    const data = d.data();
    const provenance = (data.provenance ?? {}) as Partial<SampleProvenance>;
    return {
      id: d.id,
      kind: "benign" as const,
      messageBody: typeof data.messageBody === "string" ? data.messageBody : "",
      benignDifficulty: normalizeDifficulty(data.benignDifficulty),
      provenance: {
        source: typeof provenance.source === "string" ? provenance.source : "",
        collectedAt:
          typeof provenance.collectedAt === "string"
            ? provenance.collectedAt
            : "",
        ...(typeof provenance.reference === "string"
          ? { reference: provenance.reference }
          : {}),
        ...(typeof provenance.note === "string" ? { note: provenance.note } : {}),
      },
    };
  });
}

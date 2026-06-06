import { Firestore } from "@google-cloud/firestore";
import type { RealScamSample, SampleProvenance } from "@/types/attackPattern";

// 柱2: 外部実物詐欺ホールドアウトの「評価専用」アクセス層。
//
// 不変条件A（attacker.boundary.test.ts）の最終防壁を効かせるため、このモジュールは
// 攻撃側 import グラフから到達してはならない。ファイル名・コレクション名・公開シンボルに
// 必ず "holdout" を含めることで、誤って攻撃側に繋がれた瞬間に境界テストの禁止正規表現
// (/firestore|holdout|realscamholdout/) が import 指定子で確実に捕捉する。
//
// 攻撃コーパス（attackPatterns）とは別コレクションに置く＝実物は self-play の
// 偵察・進化に絶対に混ざらない（物理分離）。読むのは defender 側の評価ハーネスのみ。
export const REAL_SCAM_HOLDOUT_COLLECTION = "realScamHoldout";

// 評価専用に独立した Firestore クライアント（firestore.ts とは共有しない）。
// 攻撃コーパス reader と一切コードパスを共有しないことで「分離」をコードでも示す。
let cachedDb: Firestore | null = null;

// Test-only escape hatch（firestore.ts と同方針）。
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

export async function upsertRealScamSample(
  id: string,
  sample: RealScamSample,
): Promise<void> {
  await getDb()
    .collection(REAL_SCAM_HOLDOUT_COLLECTION)
    .doc(id)
    .set({
      kind: sample.kind,
      messageBody: sample.messageBody,
      provenance: sample.provenance,
    });
}

export async function listRealScamHoldout(): Promise<
  Array<{ id: string } & RealScamSample>
> {
  const snap = await getDb().collection(REAL_SCAM_HOLDOUT_COLLECTION).get();
  return snap.docs.map((d) => {
    const data = d.data();
    const provenance = (data.provenance ?? {}) as Partial<SampleProvenance>;
    return {
      id: d.id,
      kind: "scam" as const,
      messageBody: typeof data.messageBody === "string" ? data.messageBody : "",
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

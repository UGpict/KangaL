import { Firestore } from "@google-cloud/firestore";
import type { UserDecision } from "@/types/feedback";

// ユーザーの逃げ道（報告／安全だと判断）の永続層。コーパス（scamSamples /
// attackPatterns）とも判定/攻撃パスとも *完全に隔離* した独立モジュール。
//
// 隔離の理由（道B 不変条件A を壊さないため）:
//  - userVerdicts は warm ループが学習材料として読む集合ではない。攻撃側 attacker.ts
//    や判定側 judge.ts の import グラフからこのモジュールへ到達できないことを
//    feedbackWriter.boundary.test.ts で静的に保証する（corpusWriter.ts と同作法）。
//  - reader を firestore.ts に相乗りさせず、本モジュール内に閉じる。userVerdicts は
//    feedback ルート専用の口であり、それ以外から読み書きしない。
//
// プライバシー: **decision と更新時刻だけ**を保存する。本文・送信者・PII は一切
// 書かない（公開 allUsers ルート前提のため特に厳守）。id は呼び出し側（route）で
// 既知 sampleMessages ID に検証済みのものだけが渡る。
export const USER_VERDICT_COLLECTION = "userVerdicts";

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

export async function recordUserVerdict(
  id: string,
  decision: UserDecision,
): Promise<void> {
  // decision と updatedAt のみ。本文・PII は保存しない。
  await getDb()
    .collection(USER_VERDICT_COLLECTION)
    .doc(id)
    .set({ decision, updatedAt: Date.now() });
}

export async function clearUserVerdict(id: string): Promise<void> {
  await getDb().collection(USER_VERDICT_COLLECTION).doc(id).delete();
}

export async function listUserVerdicts(): Promise<Record<string, UserDecision>> {
  const snap = await getDb().collection(USER_VERDICT_COLLECTION).get();
  const out: Record<string, UserDecision> = {};
  for (const d of snap.docs) {
    const v = d.data().decision;
    if (v === "reported" || v === "marked_safe") out[d.id] = v;
  }
  return out;
}

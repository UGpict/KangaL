import { SAMPLE_MESSAGES } from "@/lib/sampleMessages";
import {
  clearUserVerdict,
  listUserVerdicts,
  recordUserVerdict,
} from "@/lib/feedbackWriter";
import type { UserDecision } from "@/types/feedback";

// 公開（allUsers）ルート前提。任意キーでのコレクション汚染・任意文面の保存を塞ぐため、
// 書き込みは「既知 sampleMessages ID」だけに限定する。未知 ID はサーバ側で拒否。
const KNOWN_IDS = new Set(SAMPLE_MESSAGES.map((m) => m.id));

function isUserDecision(v: unknown): v is UserDecision {
  return v === "reported" || v === "marked_safe";
}

// 永続済みの上書きを受信箱に復元するための読み出し。userVerdicts は decision のみで
// 本文・PII を持たないので、そのまま id→decision の辞書を返す。
export async function GET(): Promise<Response> {
  try {
    const verdicts = await listUserVerdicts();
    return Response.json({ verdicts });
  } catch {
    // 認証なし等で Firestore に届かない環境では空で返す（UI は劣化せず動く）。
    return Response.json({ verdicts: {} });
  }
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const id =
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { id?: unknown }).id === "string"
      ? (payload as { id: string }).id
      : null;
  const decision = (payload as { decision?: unknown })?.decision;

  // 未知 ID 拒否: 既知 sampleMessages ID 以外には一切書かない（コレクション汚染防止）。
  if (id === null || !KNOWN_IDS.has(id)) {
    return Response.json({ error: "unknown_id" }, { status: 400 });
  }

  // decision === null は上書きの取り消し（doc 削除）。それ以外は許可値のみ受理。
  if (decision !== null && !isUserDecision(decision)) {
    return Response.json({ error: "invalid_decision" }, { status: 400 });
  }

  try {
    if (decision === null) {
      await clearUserVerdict(id);
    } else {
      await recordUserVerdict(id, decision);
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "persist_failed" }, { status: 500 });
  }
}

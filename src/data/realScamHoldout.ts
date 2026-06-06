import type { RealScamSample } from "@/types/attackPattern";

// 柱2: 外部実物詐欺ホールドアウトのコーパス（seed:holdout の投入元）。
//
// ★空で正しい★ ── ここに入るのは「実際に外部で収集した本物の詐欺文」だけ。
// フィッシング対策協議会 / IPA / JPCERT/CC / 警察庁 / 実受信メール 等から
// 正確な provenance（出典・収集日）付きで人手で投入する。
//
// 捏造禁止: それらしい詐欺文を生成して実物のふりをさせない。柱2 の「実物 recall」は
// 本物データに対してのみ意味を持ち、捏造はホールドアウトそのものを汚染する
// （docs/HANDOFF.md §4・feedback_holdout_construction）。
// また照合器ブラインド: 既存検知器が捕捉する/しないを逆算してサンプルを選ばない。
//
// 各エントリは { id, kind:"scam", messageBody, provenance:{ source, collectedAt, ... } }。
// provenance 形状は realScamHoldout.test.ts が検証する。
export const REAL_SCAM_HOLDOUT: Array<{ id: string } & RealScamSample> = [];

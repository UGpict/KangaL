"use server";

// デモページの Server Action。polling 方式（1ラウンド = 1 呼び出し）。
// ロジックは純粋モジュール _loop.ts に集約し（"use server" は全 export を async に
// 強制するため同期の純関数を置けない）、ここは buildDemoRound を呼ぶ薄いラッパに留める。
//
// ステートレス: ラウンド間の状態（現ラウンド番号・累積点）はクライアントが保持し、
// round を引数に渡して再呼び出しする（Cloud Run のステートレス前提に合致）。
//
// 8-C3 後の実データ接続: データ源をスクリプト（DEMO_ROUNDS）から実 runLoop の結果へ
// 差し替える場合も、戻り値の DemoRoundPayload 契約と変換関数（reportToToolLogs 等）は
// そのまま使えるよう設計してある。

import { assertDemoMode } from "@/lib/demoMode";
import { buildDemoRound, type DemoRoundPayload } from "./_loop";

export async function runDemoRound(round: number): Promise<DemoRoundPayload> {
  // 多層防御（Task 8-D）: Server Action は proxy を経由せず直接 POST されうるため、
  // ここでも DEMO_MODE を確認し、無効時は例外を投げる。
  assertDemoMode();
  return buildDemoRound(round);
}

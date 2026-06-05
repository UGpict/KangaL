// モード分離（Task 8-D）。攻撃エージェントをデモ/研究モード限定に閉じ込めるための
// 単一の判定点。環境変数 DEMO_MODE === "true" のときだけ有効。未設定・他の値はすべて
// 無効（フェイルセーフ: 既定で攻撃側は動かない）。Cloud Run 本番には DEMO_MODE を
// 設定しないため、本番ではデフォルトで無効になる。
//
// 厳密に文字列 "true" のみを有効とする（"1"/"yes" 等は受け付けない）。曖昧な真偽解釈で
// 意図せず有効化される事故を防ぐため。

export const DEMO_MODE_DISABLED_MESSAGE = "Demo mode is disabled";

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

// 無効時に例外を投げる。runLoop / デモ Server Action の入口で多層防御として使う。
export function assertDemoMode(): void {
  if (!isDemoMode()) {
    throw new Error(DEMO_MODE_DISABLED_MESSAGE);
  }
}

import { NextResponse } from "next/server";

// モード分離のルートゲート（Task 8-D）。Next.js 16 では従来の middleware が「proxy」に
// リネームされた（機能は同じ）。攻撃エージェントを含むデモを DEMO_MODE 限定に閉じ込めるため、
// /demo 配下（ページ表示・Server Action の POST を含む）を DEMO_MODE !== "true" のとき 403 で
// 遮断する。Cloud Run 本番には DEMO_MODE を設定しない＝デフォルトで 403（セキュアデフォルト）。
//
// 多層防御: ここで弾けなかった場合に備え、runLoop とデモ Server Action 自体も
// assertDemoMode() で例外を投げる（src/lib/demoMode.ts）。

export function proxy() {
  if (process.env.DEMO_MODE !== "true") {
    return new NextResponse(
      "Forbidden: demo mode is disabled (DEMO_MODE is not set).",
      { status: 403 },
    );
  }
  return NextResponse.next();
}

// /demo と /demo/* の両方にマッチさせる。
export const config = {
  matcher: ["/demo", "/demo/:path*"],
};

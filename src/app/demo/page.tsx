import DemoController from "./_components/DemoController";
import EthicsDisclaimer from "./_components/EthicsDisclaimer";

// 攻防ループのデモページ（Task 8-C3 / 8-D）。Server Component。最上部に倫理声明（常時表示）を
// 置き、動的に更新される部分（カード/メーター/ログ/グラフ）は子の DemoController（client）に
// 委ねる。実データ接続はスクリプト化シナリオ経由（_loop.ts / actions.ts）。
// ルートのモード分離（DEMO_MODE 未設定なら 403）は src/proxy.ts が担う。

export default function DemoPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {/* ── 倫理声明（常時表示・折りたたみ不可 / Task 8-D） ── */}
      <EthicsDisclaimer />

      <header className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">KangaL 攻防ループ デモ</h1>
        <p className="mt-1 text-sm text-foreground/60">
          攻撃AI が詐欺の型を進化させ、防御AI が調査ツールを選んで検知する。承（すり抜け）→
          転（学習）→ 結（検知率回復）をラウンドごとに可視化する。
        </p>
      </header>

      <DemoController />
    </main>
  );
}

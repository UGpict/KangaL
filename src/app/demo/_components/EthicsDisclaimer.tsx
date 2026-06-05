// 倫理声明（Task 8-D）。デモページ最上部に常時表示・折りたたみ不可。warning 色ボーダーで
// 目立たせる。純表示の Server Component（"use client" 不要）。文言は要件で固定。

export default function EthicsDisclaimer() {
  return (
    <section
      role="note"
      aria-label="倫理声明"
      className="mb-6 rounded-lg border-2 border-warning bg-warning/10 px-4 py-3 text-sm leading-relaxed text-warning"
    >
      <p className="mb-1 font-bold">倫理声明</p>
      <p>
        このデモは詐欺検知技術の研究・教育目的で動作しています。
        攻撃エージェントが生成するのは抽象的な攻撃パターン（型）のみで、
        実際の詐欺文は生成・保存されません。悪用を目的とした利用を禁じます。
      </p>
    </section>
  );
}

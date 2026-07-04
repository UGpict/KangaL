import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "利用規約 | KangaL",
  description: "KangaL の利用規約。",
};

const UPDATED = "2026-07-05";

const wrap: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "48px 22px 96px",
  color: "#24344e",
  lineHeight: 1.9,
  fontFamily:
    '"Hiragino Kaku Gothic ProN","Yu Gothic",YuGothic,"Meiryo",sans-serif',
};
const h1: React.CSSProperties = {
  fontSize: 30,
  fontWeight: 800,
  color: "#14284b",
  margin: "0 0 6px",
};
const h2: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  color: "#14284b",
  margin: "34px 0 8px",
  paddingBottom: 6,
  borderBottom: "2px solid #e2e8f4",
};
const meta: React.CSSProperties = { color: "#5f6f8c", fontSize: 13 };

export default function Terms() {
  return (
    <main style={wrap}>
      <h1 style={h1}>利用規約</h1>
      <p style={meta}>最終更新日：{UPDATED} ／ サービス名：KangaL（カンガル）</p>

      <h2 style={h2}>1. 本サービスについて</h2>
      <p>
        KangaL（以下「本サービス」）は、Gmail
        と連携して受信メールの詐欺リスクを判定し、その理由を説明する詐欺検知支援ツールです。研究・デモンストレーションを目的として無償で提供されます。
      </p>

      <h2 style={h2}>2. 判定結果の位置づけ（免責）</h2>
      <p>
        本サービスの判定・確信度スコア・説明は<strong>参考情報</strong>であり、メールの安全性・危険性を保証するものではありません。判定が誤る（安全なメールを危険と示す、またはその逆）可能性があります。最終的な判断・行動はご自身の責任で行ってください。本サービスの利用により生じたいかなる損害についても、提供者は責任を負いません。
      </p>

      <h2 style={h2}>3. Gmail 連携</h2>
      <p>
        本サービスは<strong>読み取り専用（<code>gmail.readonly</code>）</strong>で
        Gmail
        にアクセスし、メールの送信・変更・削除は行いません。データの取り扱いは
        <a href="/privacy" style={{ color: "#0e7490" }}>
          プライバシーポリシー
        </a>
        に従います。連携はいつでも解除できます。
      </p>

      <h2 style={h2}>4. 禁止事項</h2>
      <p>
        本サービスの妨害・不正アクセス・過度な自動リクエスト、他者の権利を侵害する利用を禁止します。
      </p>

      <h2 style={h2}>5. 提供の変更・停止</h2>
      <p>
        提供者は、予告なく本サービスの内容を変更または提供を停止することがあります。
      </p>

      <h2 style={h2}>6. お問い合わせ</h2>
      <p>
        お問い合わせは GitHub リポジトリ（
        <a href="https://github.com/UGpict/KangaL" style={{ color: "#0e7490" }}>
          github.com/UGpict/KangaL
        </a>
        ）の Issues よりご連絡ください。
      </p>
    </main>
  );
}

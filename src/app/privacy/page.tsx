import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "プライバシーポリシー | KangaL",
  description:
    "KangaL のプライバシーポリシー。Gmail データの取り扱い、保存しない方針、Limited Use への準拠を記載します。",
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
const call: React.CSSProperties = {
  borderLeft: "4px solid #0e7490",
  background: "#eef7fb",
  padding: "12px 16px",
  borderRadius: 6,
  margin: "16px 0",
};

export default function PrivacyPolicy() {
  return (
    <main style={wrap}>
      <h1 style={h1}>プライバシーポリシー</h1>
      <p style={meta}>最終更新日：{UPDATED} ／ サービス名：KangaL（カンガル）</p>

      <p>
        KangaL（以下「本サービス」）は、Gmail
        と連携して受信メールを自動で詐欺かどうか判定し、その理由を分かりやすく説明する詐欺検知アプリです。本ポリシーは、本サービスが取得・利用する情報とその取り扱いについて定めます。
      </p>

      <div style={call}>
        <strong>要点：</strong>本サービスは、あなたのメール本文も Gmail
        アクセストークンも<strong>サーバーに保存しません</strong>。判定はその場で行い、結果を表示するだけです。Gmail
        へのアクセスは<strong>読み取り専用</strong>で、送信・変更・削除は一切できません。
      </div>

      <h2 style={h2}>1. 取得する情報</h2>
      <ul>
        <li>
          <strong>Gmail のメールデータ（読み取り専用スコープ
          <code>gmail.readonly</code>）</strong>：あなたが連携を許可した場合に、詐欺判定のため受信メールの件名・本文・送信者・認証ヘッダを読み取ります。
        </li>
        <li>
          <strong>OAuth アクセストークン</strong>：Gmail
          にアクセスするための一時的な資格情報。
        </li>
      </ul>

      <h2 style={h2}>2. Gmail データの取り扱い（保存しない方針）</h2>
      <ul>
        <li>
          <strong>アクセストークン</strong>は AES-256-GCM
          で暗号化し、<strong>あなたのブラウザの Cookie（httpOnly / Secure /
          SameSite=Lax）にのみ</strong>保存します。<strong>サーバー・データベース・ログには一切保存しません。</strong>
        </li>
        <li>
          <strong>メール本文</strong>は、あなたがメッセージを開いたときにその場で解析するためだけに取得し、<strong>本サービスのデータベースには保存しません</strong>（解析後に破棄されます）。
        </li>
        <li>判定結果や本サービスの学習用データに、あなたの実メールの内容を書き込むことはありません。</li>
      </ul>

      <h2 style={h2}>3. 第三者への提供（処理のための送信）</h2>
      <p>
        詐欺判定のため、必要な範囲で以下の Google
        および公開サービスにデータを送信して処理します。これらは判定処理のための利用に限られ、第三者への販売・広告目的の共有は行いません。
      </p>
      <ul>
        <li>
          <strong>Google Vertex AI（Gemini）</strong>：メール内容の構造分析と説明文の生成。
        </li>
        <li>
          <strong>Google Web Risk</strong>：本文中の URL の安全性照会。
        </li>
        <li>
          <strong>RDAP</strong>：ドメインの登録日（年齢）照会。
        </li>
      </ul>

      <h2 style={h2}>4. データの保存期間</h2>
      <p>
        アクセストークンは Cookie
        の有効期限で失効します。メール本文は保存しません。<strong>いつでも連携を解除でき</strong>、解除すると本サービスは以後あなたの
        Gmail にアクセスできません（Cookie を削除するか、Google
        アカウントの「サードパーティ アクセス」からアクセス権を取り消せます）。
      </p>

      <h2 style={h2}>5. Google ユーザーデータの限定利用（Limited Use）</h2>
      <p>
        本サービスによる Google API から取得した情報の使用および転送は、
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          style={{ color: "#0e7490" }}
        >
          Google API Services User Data Policy
        </a>
        （その Limited Use
        要件を含む）に準拠します。取得した Gmail
        データは、上記の詐欺判定機能をユーザーに提供する目的にのみ使用し、広告目的での使用や、人による閲覧（サービス提供・セキュリティ・法令遵守・ユーザーの明示的同意がある場合を除く）、第三者への販売は行いません。
      </p>

      <h2 style={h2}>6. 読み取り専用</h2>
      <p>
        本サービスが要求するスコープは <code>gmail.readonly</code>
        のみです。あなたのメールの送信・変更・削除・ラベル操作は技術的にも行えません。
      </p>

      <h2 style={h2}>7. お問い合わせ・削除のご請求</h2>
      <p>
        連携の解除、データに関するご請求・お問い合わせは、GitHub リポジトリ（
        <a href="https://github.com/UGpict/KangaL" style={{ color: "#0e7490" }}>
          github.com/UGpict/KangaL
        </a>
        ）の Issues よりご連絡ください。
      </p>

      <p style={{ ...meta, marginTop: 40 }}>
        本ポリシーは予告なく改定される場合があります。改定時は本ページの最終更新日を更新します。
      </p>
    </main>
  );
}

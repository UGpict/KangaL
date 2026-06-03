export type InboxMessage = {
  id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
  // Synthetic Authentication-Results value (e.g. "spf=pass dkim=pass dmarc=pass").
  // Present only on email-like messages; SMS/chat samples should omit it.
  // Format is a deliberately simplified subset of the real header so the
  // tool layer can parse it with a controllable regex (see Chunk 2).
  authenticationResults?: string;
};

// All names, addresses, and bank references below are fictional. CLAUDE.md
// forbids using real bank/government names. The .example TLD is reserved by
// RFC 2606 so any address here is guaranteed non-routable.
export const SAMPLE_MESSAGES: InboxMessage[] = [
  {
    id: "msg-001",
    from: "田中 健 <tanaka@example.internal>",
    subject: "来週水曜の定例について",
    receivedAt: "2026-06-03 09:12",
    authenticationResults: "spf=pass dkim=pass dmarc=pass",
    body: `田中です。

来週水曜の定例ですが、いつも通り 14:00 からで大丈夫でしょうか。
資料は前日までに共有フォルダにアップしておきますので、内容を一度ご確認ください。
よろしくお願いします。`,
  },
  {
    id: "msg-002",
    from: "田中 健 <tanaka@example.internal>",
    subject: "【本日中】チーム勉強会の参加可否のご回答お願いします",
    receivedAt: "2026-06-03 11:48",
    authenticationResults: "spf=pass dkim=pass dmarc=pass",
    body: `田中です。

来週金曜のチーム勉強会、参加可否を本日中に下記フォームでご回答いただけますと助かります。
https://forms.example.internal/abc123

軽食準備の都合で締切が短くてすみません。
お手数をおかけしますが、よろしくお願いします。`,
  },
  {
    id: "msg-003",
    from: "カンガル商事 経理部 山田太郎 <yamada@kangaru-shoji.example>",
    subject: "【至急】お振込先変更のお願い(社外秘)",
    receivedAt: "2026-06-03 13:27",
    authenticationResults: "spf=fail dkim=fail dmarc=fail",
    body: `いつもお世話になっております。カンガル商事 経理部の山田です。

先ほどお電話でお伝えした請求の件ですが、振込先の口座情報を急遽変更させていただきたくご連絡しました。
新しい口座番号は本メール末尾に記載しております。

監査の都合上、新しい口座については弊社内でも一部しか把握しておりません。
本件は本メール内のみで完結させていただき、他部署や上長への共有はお控えくださいますようお願いいたします。

本日中の手配が必要ですので、お手数ですがご対応をお願いいたします。

──────────
新振込口座: カンガル銀行 ○○支店 普通 1234567 カ)カンガルシヨウジ
──────────`,
  },
];

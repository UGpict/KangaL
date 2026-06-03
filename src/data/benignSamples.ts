import type { BenignSample } from "@/types/attackPattern";

// 22 hand-written benign samples for FPR measurement (§7).
//
// Composition is deliberately mixed:
//   - 10 mundane / 4 mild-urgency / 3 has-link / 3 mild-authority
//     (incl. 2 transaction-security mimics: MFA, password expiry)
//   - 2 thread-injection candidates (continuation phrases that scams also use)
//
// Predicted scores in §-comments are hypotheses, not targets. If the real
// classifier disagrees that is data, not a bug. Avoid back-fitting samples to
// land in a desired band — that turns the FPR baseline into a circular check.
//
// All names, domains, departments are fictional. `.example` TLD is reserved
// by RFC 2606.
export const BENIGN_SAMPLES: Array<{ id: string } & BenignSample> = [
  // ── mundane (predicted < 15) ───────────────────────────────────────────
  {
    id: "ben-001",
    kind: "benign",
    messageBody:
      "田中です。\n来週水曜の定例ですが、いつも通り14時からで大丈夫でしょうか。\n資料は前日までに共有フォルダにアップしておきます。よろしくお願いします。",
  },
  {
    id: "ben-002",
    kind: "benign",
    messageBody:
      "佐藤です。\n先週の企画会議の議事録を共有フォルダに上げました。\n認識違いがあればコメントいただければ幸いです。",
  },
  {
    id: "ben-003",
    kind: "benign",
    messageBody:
      "鈴木です。\n1on1の日程ですが、来週の木曜午後と金曜午前で空いている時間帯はありますか?\nどちらでも調整できますので、ご都合の良い方をお知らせください。",
  },
  {
    id: "ben-004",
    kind: "benign",
    messageBody:
      "高橋です。\n明日午後の打ち合わせの件、私が別件で抜けるため対応をお願いできますでしょうか。\n資料は会議室に置いておきます。よろしくお願いします。",
  },
  {
    id: "ben-005",
    kind: "benign",
    messageBody:
      "中村です。\n来週月曜から水曜まで有給を取得します。\n緊急のご連絡があれば携帯までお願いいたします。",
  },
  {
    id: "ben-006",
    kind: "benign",
    messageBody:
      "伊藤です。\n先週の関西出張の報告書を共有フォルダに置きました。\n次回の参考にしていただければ幸いです。",
  },
  {
    id: "ben-007",
    kind: "benign",
    messageBody:
      "小林です。\n今週金曜のチーム雑談タイム、参加可否を教えていただけますか?\nお茶菓子を準備したいので、念のため。",
  },
  {
    id: "ben-008",
    kind: "benign",
    messageBody:
      "加藤です。\n来週、チームでランチに行こうかと話しているのですが、ご都合いかがでしょうか。\n候補日は水曜か金曜あたりです。",
  },
  {
    id: "ben-009",
    kind: "benign",
    messageBody:
      "山本です。\n最近リモートが続いていますが、業務で困っていることはありませんか?\n何かあれば気軽に Slack でも声かけてください。",
  },
  {
    id: "ben-010",
    kind: "benign",
    messageBody:
      "森です。\n申し訳ありません、子供が発熱したため本日は早退させていただきます。\n明日の朝会には間に合うよう調整します。",
  },

  // ── mild urgency (predicted 15-30) ─────────────────────────────────────
  {
    id: "ben-011",
    kind: "benign",
    messageBody:
      "経理部の池田です。\n今月分の経費精算は今月末日までにご提出をお願いいたします。\n月末締めの都合上、遅れますと翌月処理になりますので、ご注意ください。",
  },
  {
    id: "ben-012",
    kind: "benign",
    messageBody:
      "人事部の渡辺です。\n社員意識調査のご回答を、明日の朝までにお寄せいただけますと幸いです。\n回答は匿名で集計されます。",
  },
  {
    id: "ben-013",
    kind: "benign",
    messageBody:
      "採用担当の阿部です。\n候補者の面接日程について、本日中にご返答いただけますとスケジュールが組みやすいです。\nお手数ですがよろしくお願いします。",
  },
  {
    id: "ben-014",
    kind: "benign",
    messageBody:
      "清水です。\n明日の朝会で議論したい議題が出てきたのですが、追加してもよろしいでしょうか。\n10分ほど時間をいただければ十分です。",
  },

  // ── has link (predicted 15-30) ─────────────────────────────────────────
  {
    id: "ben-015",
    kind: "benign",
    messageBody:
      "勉強会幹事の藤田です。\n来月の社内勉強会、参加可否を下記フォームでご回答ください。\nhttps://forms.example.internal/study-001\n軽食準備の都合で、来週水曜までにお願いします。",
  },
  {
    id: "ben-016",
    kind: "benign",
    messageBody:
      "教育担当の岡田です。\n新人向けナレッジ共有 wiki を社内ポータルに用意しました。\nhttps://wiki.example.internal/new-hire\n適宜更新していく予定ですので、ご活用ください。",
  },
  {
    id: "ben-017",
    kind: "benign",
    messageBody:
      "マネージャの長谷川です。\n月次の 1on1 振り返りアンケートを下記フォームに準備しました。\nhttps://forms.example.internal/one-on-one\n10 分程度で終わる内容です。ご協力お願いします。",
  },

  // ── mild authority + transaction-security mimics (predicted 15-35) ────
  {
    id: "ben-018",
    kind: "benign",
    messageBody:
      "経理部 自動通知です。\n2026年5月分の経費精算が未提出の方への確認です。月末締めまでにご提出をお願いいたします。\n詳細は経理ポータルをご参照ください。",
  },
  {
    id: "ben-019",
    kind: "benign",
    messageBody:
      "情報システム部です。\n社内アカウントのセキュリティ強化のため、来月15日までに多要素認証(MFA)の登録をお願いいたします。\n登録手順は下記をご参照ください: https://portal.example.internal/security/mfa\nご不明点はヘルプデスクまでご連絡ください。",
  },
  {
    id: "ben-020",
    kind: "benign",
    messageBody:
      "情報システム部 自動通知です。\nご利用のアカウントのパスワード有効期限が06/20に切れます。\n下記より期限内に変更をお願いいたします: https://portal.example.internal/password-change\n期限後はログインができなくなりますので、お早めにご対応ください。",
  },

  // ── thread-injection candidates (predicted 20-35) ──────────────────────
  {
    id: "ben-021",
    kind: "benign",
    messageBody:
      "先ほどお話しした件、確認しました。\n問題なさそうですので、次のステップに進めていただいて大丈夫です。\n何か追加で必要な情報があればご連絡ください。",
  },
  {
    id: "ben-022",
    kind: "benign",
    messageBody:
      "加藤です。\n先日の打ち合わせでお伝えしたとおり、来月の予算は前年同水準で進めます。\n詳細は別途共有資料をご確認ください。",
  },
];

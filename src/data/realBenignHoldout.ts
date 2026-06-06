import type { RealBenignSample } from "@/types/attackPattern";

// 柱2 道A: 外部実物「良性」ホールドアウトのコーパス（seed:holdout-benign の投入元）。
//
// 帯（benignDifficulty）は実態どおり2クラスを同居させる:
//   - easy（制度・銀行帯）: 制度/銀行の本物通知。締切・行動 URL を持たず、レバーが
//       立たない。床を下げても誤検出しないことを確認する control。FPR は楽観側（下界）。
//   - effective（商用帯）: 楽天/amazon/apple 等の本物。締切/行動要求/行動 URL を備える
//       ＝床を下げると FP が集中するストレッサー。FPR は保守側（下界扱いにしない）。
//
// 捏造禁止: 「それっぽい正規メール」を書いて real とラベルしてはならない。easy は公式
// 公開ページの verbatim、effective は実受信箱から PII を伏字にしてユーザーが貼る本物のみ。
// verbatim 厳守: 言い換えるとレバー骨格が変わり測定が汚れる。provenance 必須
// （source / collectedAt が空なら seeder が弾く）。realBenignHoldout.test.ts が形状を検証。
//
// ★effective 帯は現状あえて空★ ── 商用帯の本物 effective は実受信箱・PII 込みなので、
// ユーザーが PII を伏字にし「伏字の事実」を provenance.note に記録した形で貼る。CC は
// それっぽい正規メールを作文しない。下部の空きスロット（コメント）に貼る。
export const REAL_BENIGN_HOLDOUT: Array<{ id: string } & RealBenignSample> = [
  // ★帯ラベルの意図（誤読防止）: 制度帯（e-Tax 等）は本物が *構造的に* non-effective
  //   ＝締切も行動 URL も持たない。だから easy ラベルは「手抜き／詐称」でなく実態そのもの
  //   （effective に分類し忘れたのではない）。effective stressor は商用帯（楽天/amazon/apple）
  //   にのみ実在し、それは下部の空きスロットへ実受信で投入する。
  // ── easy 帯（制度帯 control）: e-Tax/国税庁 公式公開のお知らせメール本文 verbatim ──
  // 出典: https://www.e-tax.nta.go.jp/topics/topics_oshirase_mail.htm
  // 送信元 info@e-tax.nta.go.jp。「原則としてメール本文内にURLを記載していません」＝
  // 行動 URL なし＝non-effective。＊＊＊＊様 は公式掲載時点の宛名伏字（原文ママ）。
  {
    id: "etax-notice-shinkoku-2026-06",
    kind: "benign",
    benignDifficulty: "easy",
    messageBody: `税務署からのお知らせ（＊＊＊＊様）【申告に関するお知らせ】

＊＊＊＊様

e-Taxをご利用いただきありがとうございます。

国税に関する申告の参考となる情報について、メッセージボックスに格納しましたので、内容をご確認ください。

e-Taxの利用可能時間内に、e-Taxホームページからログインの上、「お知らせ・受信通知」よりご確認いただけます。

○　注意事項
・メッセージボックスのお知らせの内容の詳細を確認するためには、マイナンバーカードまたはスマホ用電子証明書等の電子証明書による認証が必要です。詳細は、e-Taxホームページの「メッセージボックスのセキュリティ強化について」からご確認ください。
・e-Taxの利用可能時間は、e-Taxホームページでご確認ください。

※　本メールは、e-Tax（国税電子申告・納税システム）にメールアドレスを登録いただいた方へ配信しております。
なお、本メールアドレスは送信専用のため、返信を受け付けておりません。ご了承ください。
----------------------------------------------------------
発行元：国税庁
Copyright (C) NATIONAL TAX AGENCY ALL Rights Reserved.
----------------------------------------------------------`,
    provenance: {
      source: "国税庁 e-Tax 公式（公開テンプレ）",
      reference: "https://www.e-tax.nta.go.jp/topics/topics_oshirase_mail.htm",
      collectedAt: "2026-06-06",
      note: "公式公開のお知らせメール文例の verbatim。本文に行動 URL なし＝non-effective。宛名は公式掲載時点の伏字（＊＊＊＊様）。",
    },
  },
  {
    id: "etax-notice-nozeishomeisho-2026-06",
    kind: "benign",
    benignDifficulty: "easy",
    messageBody: `税務署からのお知らせ（＊＊＊＊様）【納税証明書に関するお知らせ】

＊＊＊＊様

e-Taxをご利用いただきありがとうございます。

ご請求された納税証明書に関するお知らせについて、メッセージボックスに格納しましたので、内容をご確認ください。

e-Taxの利用可能時間内に、e-Taxホームページからログインの上、「お知らせ・受信通知」よりご確認いただけます。

○　注意事項
・メッセージボックスのお知らせの内容の詳細を確認するためには、マイナンバーカードまたはスマホ用電子証明書等の電子証明書による認証が必要です。詳細は、e-Taxホームページの「メッセージボックスのセキュリティ強化について」からご確認ください。
・e-Taxの利用可能時間は、e-Taxホームページでご確認ください。

※　本メールは、e-Tax（国税電子申告・納税システム）にメールアドレスを登録いただいた方へ配信しております。
なお、本メールアドレスは送信専用のため、返信を受け付けておりません。ご了承ください。
----------------------------------------------------------
発行元：国税庁
Copyright (C) NATIONAL TAX AGENCY ALL Rights Reserved.
----------------------------------------------------------`,
    provenance: {
      source: "国税庁 e-Tax 公式（公開テンプレ）",
      reference: "https://www.e-tax.nta.go.jp/topics/topics_oshirase_mail.htm",
      collectedAt: "2026-06-06",
      note: "公式公開のお知らせメール文例の verbatim。本文に行動 URL なし＝non-effective。",
    },
  },
  {
    id: "etax-notice-nofu-kanryo-2026-06",
    kind: "benign",
    benignDifficulty: "easy",
    messageBody: `税務署からのお知らせ（＊＊＊＊様）【納付完了に関するお知らせ（納付手続重複）】

＊＊＊＊様

e-Taxをご利用いただきありがとうございます。

電子納付に係るお手続きが完了しましたが、ご確認いただきたい内容がございますのでご連絡します。

詳細については、メッセージボックスに格納しましたので、内容をご確認ください。

○　注意事項
・e-Taxの利用可能時間は、e-Taxホームページでご確認ください。

※　本メールは、e-Tax（国税電子申告・納税システム）にメールアドレスを登録いただいた方へ配信しております。
なお、本メールアドレスは送信専用のため、返信を受け付けておりません。ご了承ください。
----------------------------------------------------------
発行元：国税庁
Copyright (C) NATIONAL TAX AGENCY ALL Rights Reserved.
----------------------------------------------------------`,
    provenance: {
      source: "国税庁 e-Tax 公式（公開テンプレ）",
      reference: "https://www.e-tax.nta.go.jp/topics/topics_oshirase_mail.htm",
      collectedAt: "2026-06-06",
      note: "公式公開のお知らせメール文例の verbatim。納付完了通知。行動 URL なし＝non-effective。",
    },
  },

  // ── effective 帯（商用帯ストレッサー）: 空きスロット ──
  // ★ここに楽天/amazon/apple 等の本物の正規メールを貼る（実受信・PII 伏字）。★
  // 形状の例（コメントのまま。CC は作文しない＝ユーザーが本物を貼って初めて有効化）:
  //   {
  //     id: "rakuten-genuine-XXXX-2026-06",
  //     kind: "benign",
  //     benignDifficulty: "effective",
  //     messageBody: `<実受信の正規メール本文を verbatim、PII は伏字>`,
  //     provenance: {
  //       source: "実受信",
  //       collectedAt: "2026-06-06",
  //       note: "本物の正規メール。氏名/注文番号/会員IDを●●で伏字（伏字の事実をここに記録）。",
  //     },
  //   },
];

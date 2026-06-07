# Task 9 チャンク3 追補: 緑判定の理由文トーンをバンド連動（結論↔理由の矛盾修正）

実施日: 2026-06-07

## 症状
公開URLの判定カードで、緑（score<70）判定なのに理由文が「役員なりすまし・URL誘導・
注意が必要」と詐欺手口を断定列挙し、結論「目立った問題は見つかりませんでした」と矛盾。
false-positive 的に見えていた（画像2: score 57 緑 ／ 画像1: score 29 緑 でも理由が
詐欺手口説明）。

## 切り分け（根本原因）
判定 score 計算ではなく **理由文の生成プロンプト** が原因。`src/agents/judge.ts` の
`buildSystemInstruction` が、score を payload データとして渡しつつも【役割】を常に
「**なぜ危ないか** を 2〜3 文で説明する」に固定していた。`pickActivePayload` は strength>0 の
レバーを全て渡すため、緑でも弱く立っているレバー（authority=business_partner、URL click 等）を
モデルが「詐欺の手口」として断定説明していた。→ 理由生成がバンドと独立だったのが根本原因。

## 修正（理由生成のみ・score は不変）
- `src/lib/weights.ts`: `DANGER_SCORE_THRESHOLD = 70` を**単一真実源**として追加
  （judge と UI が共有）。値は校正済み閾値ではない旨を明記（FPR 未測・writeup 限界節と一貫）。
- `src/agents/judge.ts`: `buildSystemInstruction(tag, band)` をバンド連動化。
  - danger（score≥70）: 従来通り「なぜ危ないか」。
  - safe（score<70）: 「なぜ明確な問題が見つからなかったか・危険シグナルがなぜ弱いか」を中心に。
    詐欺/なりすまし/フィッシングの**断定と危険列挙を禁止**。「絶対に安全」とも言い切らない。
  - 調査所見（senderAuth fail 等）は緑では危険認定の根拠として誇張せず事実として穏やかに触れる。
  - band は `score >= DANGER_SCORE_THRESHOLD` で判定（UI と同一境界＝結論と必ず一致）。
- `src/components/InboxApp.tsx`: ハードコード 70（riskBandFromScore / listMarker）を共有定数へ。
- `src/agents/__tests__/judge.test.ts`: テスト +2。
  - 赤（BEC score 92）→ instruction に「危険度が高い(赤)」「なぜ危ないか」、緑文言を含まない。
  - 緑（isolation=1 score 10・レバー有でも）→「危険度は高くない(緑)」「断定」禁止文言、
    「なぜ危ないか」を含まない。

## 制約順守
- 判定 score・70 閾値・computeScore は**不変**（FPR 本番未測のため正規化・閾値を動かさない）。
- 緑の過信防止1行「『絶対に安全』という意味ではありません」は UI 側に維持。
- 直したのは Gemini 生成文のトーン制御のみ（コピーの絆創膏ではなく生成の根本制御）。

## 検証
- `npx vitest run`: 268 passed / 6 skipped（+2 band tone）。`tsc --noEmit` エラーなし。
  `npx next lint`: 0 errors（既存 warning のみ）。
- 再デプロイ: ビルド元コミット `b02675b`（03ff9f0 の作法: probe+tempフックstash→HEADから
  ビルド→pop）。新リビジョン **kangal-00004-vkr**（100%トラフィック）。
  URL: https://kangal-649847191589.us-central1.run.app
- **公開URL 実機確認（緑サンプル・画像2相当）**: score 20（緑）で理由は
  「すぐに危険と判断できるような強い兆候は見られませんでした。ただし、送信元が本当に
  名乗っている人からのものか…確認が十分に取れていないようです。もしリンクをクリックする
  よう促されていても、少し立ち止まって確認することをおすすめします。」
  → **詐欺/なりすまし断定なし・緑結論と一致**。修正がライブで確認できた。

## 付記（スコープ外の観測）
強めの BEC 風文面（振込先変更＋他言禁止＋至急）も本番では score 20（緑）だった。本番
`analyzeStructure`（Gemini 抽出）が isolation 等を強く取らない傾向で、これは score 校正の
領域（今回不変・FPR 未測）。赤バンド→危険トーンの担保は決定的なバンドルーティングと
ユニットテストで確保。本番で赤を踏むサンプルが少ない事実は、緑トーン修正の重要性を裏づける。

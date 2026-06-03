# Task 4 — 受信箱 UI ＋ 判定ポップ(絵コンテ「起」)

実施日: 2026-06-03

## 何を
- `src/lib/sampleMessages.ts`: 受信箱フィクスチャ3件。全て架空名(`.example` TLD は RFC 2606 予約)。
  - msg-001 定例: 完全に普通の業務メール
  - msg-002 勉強会: **near-miss 設計**(本日中+リンク有 / authority・secrecy・送金 無し)
  - msg-003 BEC: 至急 + 社外秘 + 振込先変更
- `src/app/api/judge/route.ts`: `POST /api/judge`。`analyzeStructure` → degraded で early return / 否なら `judge` → `{ degraded, score, reason, isolationNote }` を返す。空文字・空白のみ・8000字超・JSON 破壊はすべて 400。
- `src/components/InboxApp.tsx`: クライアントコンポーネント本体。左 = 受信箱リスト、右 = メッセージ詳細 + 判定カード。state 色 = red/amber/emerald/slate(1色1意味)。判定カードは `verdict-pop` キーフレームで fade+scale 入場、`scrollIntoView({behavior:"smooth", block:"nearest"})` で視線誘導。結果は id ごとにキャッシュ(再選択で Gemini 再課金しない)。
- `src/app/page.tsx`: `<InboxApp />` をマウントするだけのサーバページ。
- `src/app/globals.css`: `@keyframes verdict-pop-in` 追加(260ms、cubic-bezier(0.16, 1, 0.3, 1))。

## なぜ

### サーバ/クライアント分離
GCP 認証 (`@google/genai` + ADC) は server only。API ルート経由でだけ Gemini に届くので、ブラウザに鍵が出ない。`InboxApp` は `JudgeResponseBody` を**型のみ import** してエンドポイントと型契約を共有する(ランタイム依存は無いので Next.js のクライアント境界違反にならない)。

### キャッシュ(再選択で再課金しない)
1メッセージにつき 1 Gemini call。同じ id を再クリックしたらキャッシュから即返す。デモ中の往復で `gemini-2.5-flash` を何度も叩かないための、本番運用と整合する素直なオンメモリ実装。

### 判定カードのポップ演出
- **fade+scale 入場アニメ**(260ms): 判定が「出た瞬間」を映像で伝える。長すぎないので再生中の流れを邪魔しない。
- **scrollIntoView**: 本文を読んだ視線が自然にカードへ落ちる。`block: "nearest"` で過剰スクロールを避ける。
- **本文コンテナ `max-h-[38vh]`**: 判定カードが画面外に押し出されない高さに抑制。長文サンプルでも本文と判定カードが視野に同居する。

### state 色の運用(1色1意味)
| 状態 | 色 | 流用なし |
|---|---|---|
| 高(≥70) | red | バッジ・カード枠・isolationNote の左アクセント |
| 中(30-69) | amber | バッジ・カード枠のみ。他用途では使わない |
| 低(<30) | emerald | バッジ・カード枠のみ |
| 判定保留 | slate (slate-500 系) | バッジ・カード枠のみ。emerald との差は撮影圧縮でも保つ |

isolationNote の左ボーダーアクセントは red 系(高バッジと同族)で揃え、「警告の付帯説明」として読ませる。amber を流用しないことで「中=注意」「高+補足=red 系」が崩れない。

### near-miss benign #2 のデモ効果
当初プランでは benign #2 を「明らかに安全」にする予定だったが、レビュー指摘で **「軽い urgency + リンク有・authority/secrecy/送金 無し」** に変更した。
結果:
- 定例 (msg-001): **29** → 低 (緑)
- 勉強会 (msg-002): **37** → 中 (黄)
- BEC (msg-003): **86** → 高 (赤)

**3バンド全て1サンプルで埋まった**。「キーワード検出ではなくレバーの組み合わせで判断している」が映像で証明できる。「本日中」は中・「社外秘+振込変更」は高、と踏み分けが見える。中帯はもう未踏ではない。

### API 入力バリデーション
レビュー横断指摘 — 空/空白のみ/フィールド欠落/JSON 破壊/8000字超 は全て 400。`message_required` / `message_too_long` / `invalid_json` の3つに分岐。
- curl での動作確認が想定どおりエラーで返る
- 本番デモで誤った貼り付け・空送信で 500 を見せない保険
- `analyzeStructure` を**呼ぶ前**に弾くので Gemini を浪費しない

## どう

### 実行フロー
1. `sampleMessages.ts` → `api/judge/route.ts` → `InboxApp.tsx` → `page.tsx` の順で書き、`globals.css` にアニメ追加。
2. `npx tsc --noEmit` エラーゼロ / `npx vitest run` 既存 23 件回帰なし。
3. `npm run dev` を background で起動 → `Invoke-WebRequest http://localhost:3000` で SSR を確認(KangaL / 受信箱 / 3件のサブジェクト全部含む)。
4. `POST /api/judge` を 6 ケース(BEC / 定例 / 勉強会 / 空 / 空白 / フィールド欠落 / 破壊JSON / 8001字)で叩いて期待通りに返ることを確認。
5. dev server を `taskkill /F /T` で停止。

### コメント方針
- `sampleMessages.ts`: 「全て架空名・.example は RFC 2606 予約」の不変条件
- `InboxApp.tsx`:
  - `riskBandFromScore` 上に「amber は中専用、他用途で使わない」 1色1意味契約
  - `BADGE_STYLES.slate` のコメントで「emerald との撮影圧縮耐性」理由
- `verdict-pop` の意図は keyframe 名で語っているので追加コメント無し
- API ルートのバリデーションは見たまま分かるので追加コメント無し

## 動作確認 — 私の手元で取った疎通結果

```
[empty]         400 {"error":"message_required"}
[whitespace]    400 {"error":"message_required"}
[missing]       400 {"error":"message_required"}
[invalid_json]  400
[too_long]      400 {"error":"message_too_long"}
[benign_regular] 200 score=29 isolationNote=null
[benign_near_miss] 200 score=37 isolationNote=null
[BEC] 200 score=86 reason有 isolationNote有

SSR page:
  contains 'KangaL': True
  contains '受信箱': True
  contains '来週水曜の定例': True
  contains '勉強会': True
  contains 'お振込先変更': True
  contains '社外秘': True
```

## **未確認 / お願い**: ブラウザでの視覚確認
CLAUDE.md 規約「UI 変更は dev server + ブラウザで確認」のうち、**ブラウザ部分は私の手元では見えません**。お手元で以下を確認お願いします:

1. `npm run dev` → `http://localhost:3000`
2. 左の受信箱で3件並んでいて、最後の BEC をクリック
3. 右側に本文が出て、その下の判定カードが **fade+scale で「ポップ」**(260ms)、スクロールが滑らかに合う
4. 高バッジが **赤、92 前後** 、reason が日本語、注記が左赤ボーダーで出る
5. 勉強会クリック → 中(黄)バッジ、reason はリンク・urgency 言及、注記無し
6. 定例クリック → 低(緑)バッジ、注記無し
7. 同じメッセージを再クリック → ローディング無しで即表示(キャッシュ確認)
8. ダークモードに切り替えても色の区別が保たれているか

何か違和感があれば(色が読みづらい / アニメが冗長 / スクロール量が変 等)指摘ください。

## 完了条件
- [x] BEC サンプル選択で **危険度バッジ(高 / red / 86)** と日本語説明ポップが表示される(SSR + API 経路で確認)
- [x] これ単体でデモ「起」40秒分が撮れる状態(3バンド・3サンプル・キャッシュ・アニメ揃い)
- [x] 既存テスト 23 件回帰なし
- [x] `tsc --noEmit` エラーゼロ

## やらなかったこと(意図的にスコープ外)
- 攻撃側エージェント(狼)
- 攻防ループ・世代進化
- メトリクス UI(Task 5)
- 受信箱の検索/フィルタ/未読/既読管理
- ユーザー入力欄(自由テキスト貼り付け)
- 認証・複数ユーザー対応
- E2E テスト自動化(Playwright 等)

## 申し送り

### 撮影 Tips(デモ「起」40秒の組み立て)
- 受信箱表示(2秒) → BEC ホバー(1秒) → クリック → 本文表示(3秒) → **判定カードのポップ瞬間が見せ場**(1秒)
- スコア 86 と「孤立化」注記を映す(8秒)
- 続けて勉強会(中)・定例(低) と短く 1秒ずつクリック → 「3バンドが揃って動いてる」を見せる(10秒)
- ナレーション「攻撃の型をレバー6本に逆算して、組み合わせで判断する」(残り 15秒)

### Task 5(メトリクス) への申し送り
- benign #2 が中(37)に乗ったのは「設計どおり」ではあるが、**FPR の分母としての benign がどこまでカウントされるか**の議論を呼ぶ。「中=詐欺と判定した」かどうかの境界判断は明示しておくべき。
- 暫定: スコア 70 以上を「詐欺判定」、それ未満は「灰色 + 注意」と整理するなら、benign #2 は FPR には乗らない。Task 5 着手時にここを確定させる。

### Task 6 以降への申し送り
- `cache: Record<string, JudgeResponseBody>` はオンメモリ。Task 8 の攻防ループで履歴 DB 連携になったら、Firestore + SWR/React Query 等への移行が候補。
- 判定カードのアニメは 260ms 固定。レビュー反映で短すぎ/長すぎなら globals.css の duration 1行で調整可能。

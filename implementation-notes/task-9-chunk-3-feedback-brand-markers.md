# Task 9 チャンク3: 逃げ道の Firestore 永続 ＋ ブランド navy+cyan ＋ 受信箱マーカー

実施日: 2026-06-07

判定カードの「次の一手（逃げ道）」を Firestore へ永続し、受信箱に状態マーカーと
ブランド世界観（navy+cyan）を入れた。永続はコーパス／判定・攻撃パスから完全隔離する。

## 追加・変更ファイル
- `src/types/feedback.ts`（新規）— `UserDecision` 型。client-safe な場所に置き、
  `"use client"` の InboxApp と server の writer/route が共有（firestore を client へ
  漏らさない）。
- `src/lib/feedbackWriter.ts`（新規）— `userVerdicts` 専用の独立 writer/reader
  （`recordUserVerdict` / `clearUserVerdict` / `listUserVerdicts`）。独自 Firestore
  クライアント。**decision と updatedAt のみ保存・本文/PII は書かない**。
- `src/app/api/feedback/route.ts`（新規）— `POST`（書き込み/取り消し）と `GET`（復元）。
- `src/app/api/feedback/__tests__/route.test.ts`（新規）— バリデーション/分岐テスト。
- `src/lib/__tests__/feedbackWriter.boundary.test.ts`（新規）— 隔離の境界テスト。
- `src/components/InboxApp.tsx`（変更）— NextSteps を controlled 化、decisions 状態を
  親へ持ち上げ＋起動時 GET 復元、navy+cyan ヘッダー、受信箱マーカー＋上書きタグ。

## Firestore 永続の制約（ユーザー指示を全て反映）
- 書き込みは `userVerdicts/{id}` のみ。
- **id は既知 sampleMessages ID のみ受理**。`KNOWN_IDS = new Set(SAMPLE_MESSAGES.map(id))`
  で照合し、**未知 ID はサーバ側で 400 拒否**（任意キーでのコレクション汚染を塞ぐ）。
- **本文・PII を保存しない**。保存するのは `{ decision, updatedAt }` のみ。任意文面動線は
  そもそも存在せず、route は id+decision しか受け取らない。
- writer は `corpusWriter.ts` ではなく **feedback 専用モジュールに分離**。judge パス／
  コーパス（scamSamples / attackPatterns）から完全隔離。
- **公開（allUsers）前提**で上記バリデーションを必須に。`decision` も許可値
  （`reported` / `marked_safe` / `null`）以外は 400。

## 道B 不変条件A の保護（境界テスト）
`feedbackWriter.boundary.test.ts` は `judge.ts` と `attacker.ts` の import グラフを
再帰的にたどり、`feedbackWriter.ts` が**到達集合に現れないこと**を assert
（attacker.boundary.test.ts と同じ作法）。これにより「判定/学習パスは userVerdicts へ
書けない」を規約でなく**到達不能性**で固定。健全性チェック（グラフが実際に辿れている）も
同梱。`decision:null` は上書きの取り消し（doc 削除）。

## UI（色/ブランド/マーカーは doc とモックが仕様）
- **ブランド navy+cyan はヘッダーにのみ**適用。`--brand-navy` 背景＋`--brand-accent` で
  「KangaL」の "L" を差し色（支配色＋鋭いアクセント）。状態色（赤/緑/灰）とは混ぜない。
- **受信箱マーカー**: `cache[id]` の判定から導出。危険(score≥70)=赤点／degraded=灰点／
  **安全と未判定は印なし＝静か**（フリクションは危険側に集中）。色は `--risk-danger` /
  `--risk-degraded` を参照＝**状態色トークンを新サーフェスへ配線**（単一の真実源）。
- 上書き済みは小さな「報告済み／安全と判断」タグを控えめに表示。

## 状態色トークンの配線状況（更新）
- ブランド `--brand-navy/-accent`: **ヘッダーへ配線済み**。
- 状態色 `--risk-danger/-degraded`: **受信箱マーカーへ配線済み**（単一の真実源として使用）。
- 判定バッジ/カードの多階調パレット（`BADGE_STYLES` / `cardBorder`）は**意図的に
  Tailwind クラスのまま**据え置き。camera 圧縮耐性のために調整した多階調コントラスト
  （slate を emerald と明確に差をつける配慮を含む）を崩さないため。単一色相の var に
  畳むと階調が失われるので、ここはコンポーネント内の単一定義をもって真実源とする。
- `--risk-safe` / `--risk-caution`（未使用）はトークン定義として保持。

## 検証
- `npx tsc --noEmit`: エラーなし
- `npx vitest run`: 266 passed / 6 skipped（+13: feedback route 9・boundary 4）
- `npx next lint`: 0 errors（既存 warning のみ）
- `npx next build`: 成功。`/api/feedback` が dynamic ルートとして登録、client 配線も通過。
- ブラウザ実機: 判定カード/永続の往復は `/api/judge`・`/api/feedback`（GCP 認証）が要るため
  本環境ではライブ確認未実施。型/テスト/lint/build で静的に担保。

## doc チェックリスト充足（チャンク1〜3 通算）
- 状態色は1意味・ブランド色と分離 ✓
- 判定カード「結論→理由→根拠(折りたたみ)→次の一手」 ✓
- 理由は短く・技術詳細は段階的開示 ✓
- AI 判定に逃げ道（上書き・可逆） ✓ ＋ 永続 ✓
- degraded を正直に・緑と区別・偽の安全表示にしない ✓
- 視覚的フリクションは危険側に集中（赤=solid／緑・灰は静か／リスト印も危険のみ） ✓

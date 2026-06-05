# Task 8-C1: メトリクス推移グラフ（recharts 単体）

実施日: 2026-06-04

攻防ループの recall / FPR / coverage 推移を recharts で可視化する再利用コンポーネント
`MetricsChart` を新規作成した。デモページへの組み込み・実データ接続は Task 8-C3。

## 追加・変更ファイル
- `src/app/demo/_components/MetricsChart.tsx`（新規）— グラフ本体・型・MOCK_ROUNDS
- `src/app/globals.css`（変更）— 役割色トークン 3 つを `@theme inline` に追加
- `package.json` / `package-lock.json`（変更）— recharts 3.8.1 を追加

## ファイルパスの判断
タスク指定は `app/demo/_components/MetricsChart.tsx` だが、本プロジェクトの App Router は
`src/app` 配下（tsconfig の `@/*` → `src/*`、既存 `src/app/page.tsx` 等）。よって
`src/app/demo/_components/MetricsChart.tsx` に配置した。

## 設計判断

### 1. Client Component（`"use client"`）
recharts は内部で hooks と DOM（ResponsiveContainer の ResizeObserver）を使うため
Client Component 必須。Next 16 App Router の作法どおり先頭に `"use client"` を置く
（`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` 確認済み）。
デモページ（Server Component 想定）からは子として差し込む。

### 2. Props 型は表示専用の `RoundMetricsPoint`（lib の RoundMetrics とは別物）
`src/lib/metrics.ts` の `RoundMetrics` は `{ recall; fpr }`（`Ratio = number | null`、
round/coverage なし）。グラフは「描画可能な数値（0〜1）」だけを受け取りたいので、
`{ round; recall; fpr; coverage }`（全て number）の表示専用型を本ファイルで定義・export した。
lib の集計結果 → この形への変換（null の扱い・coverage の供給）は実データ接続（8-C3）の責務。
ここでは描画契約のみを固定する。タスクの `MetricsChartProps.rounds: RoundMetrics[]` は
この `RoundMetricsPoint[]` として実装している（lib の同名型を import すると形が合わないため）。

### 3. 色は globals.css の役割トークン（var(--color-*)）
- `--color-brand: #2563eb`（blue-600）→ recall
- `--color-warning: #d97706`（amber-600）→ FPR
- `--color-action: #059669`（emerald-600）→ coverage

値はユーザー指定。既存 InboxApp の Tailwind パレット（emerald/amber/zinc）と色相を合わせ、
UI 全体との乖離を防ぐ。recharts の `<Line stroke="var(--color-brand)">` で直接参照する。

### 4. 折れ線の見せ方
- `type="linear"`: recall の「ギザギザ回復」をなまさず忠実に見せるため monotone ではなく linear。
- Y 軸は `domain={[0,1]}`、目盛り `[0,0.25,0.5,0.75,1]`。X 軸はラウンド番号（`R1` 表記）。
- 凡例（Legend）・Tooltip あり。`ResponsiveContainer width="100%"` で親幅に追従、高さは `height` prop（既定 320）。
- 余白・背景は `className` prop で呼び出し側が Tailwind 制御（Tailwind と共存）。

### 5. MOCK_ROUNDS 同梱
単独確認（Storybook 相当）のため 6 ラウンド分のモックを export。
recall ギザギザ・fpr 低位安定・coverage 増加の 3 ストーリーが 1 枚で見える値にしてある。

## テスト方針（ユーザー承認済み）
- 完了扱いの基準: **tsc green ＋ 単独 import 可能 ＋ MOCK_ROUNDS 同梱**。
- jsdom / @testing-library の導入は本タスクのスコープ外（既存テスト基盤は
  `environment: "node"`・`*.test.ts` のみで、コンポーネント描画テストの基盤が無い）。
- **描画の最終目視はブラウザで行う**: `npm run dev` 後、8-C3 で `/demo` ルートに組み込んでから
  3 本の折れ線（recall=青 / FPR=橙 / coverage=緑）を確認する。この環境ではブラウザ確認を
  実施できていないため、描画の目視確認は未完（コード・型のみ green）である点を明記する。

## 完了確認
- `npx tsc --noEmit` → exit 0
- `npx vitest run` → 162 passed / 6 skipped（recharts 追加・globals.css 変更による回帰なし）
- `MetricsChart` / `MOCK_ROUNDS` / `RoundMetricsPoint` / `MetricsChartProps` が単独 import 可能

## やっていないこと（後続）
- デモページへの組み込み・ループとの実データ接続（Task 8-C3）
- 他コンポーネント（カード・ログ・メーター）（Task 8-C2）
- ブラウザでの描画目視（dev サーバ／8-C3 組み込み後）

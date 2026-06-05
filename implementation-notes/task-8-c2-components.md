# Task 8-C2: 攻撃型カード / ツール選択ログ / 検知率メーター（3 純表示コンポーネント）

実施日: 2026-06-04

攻防ループの可視化に使う 3 つの再利用コンポーネントを新規作成した。いずれも単独で
import・描画できる純表示（presentational）部品で、デモページへの組み込み・実データ接続は
Task 8-C3。

## 追加ファイル
- `src/app/demo/_components/AttackPatternCard.tsx`（新規）— 攻撃型 6 レバーを 1 枚で可視化
- `src/app/demo/_components/ToolSelectionLog.tsx`（新規）— 防御エージェントのツール選択ログ
- `src/app/demo/_components/DetectionMeter.tsx`（新規）— recall / FPR を 2 本のメーターで表示

各ファイルに単独確認用モック（`MOCK_ATTACK_PATTERN` / `MOCK_TOOL_LOGS` / `MOCK_DETECTION`）を
同梱した。

## ファイルパスの判断
タスク指定は `app/demo/_components/` だが、本プロジェクトの App Router は `src/app` 配下
（tsconfig の `@/*` → `src/*`）。8-C1（MetricsChart）と同じく `src/app/demo/_components/` に配置。

## Server / Client の判断
3 つとも hooks・イベント・ブラウザ API を使わない純表示部品のため、すべて **Server Component**
（`"use client"` 不要）。recharts を内包する MetricsChart（8-C1）だけが Client Component で、
本タスクの 3 部品とは性質が異なる。

## 色の役割マッピング（ユーザー承認済み）
ハードコード色は禁止。globals.css の `@theme inline` トークン（Tailwind ユーティリティ）のみ使用。
1 色 = 1 意味の原則で統一する。

- **brand（青 `--color-brand`）**: generation バッジ、recall メーター
- **action（緑 `--color-action`）**: called=true、channel バッジ、intensity バー/ドット
- **warning（橙 `--color-warning`）**: FPR メーター、fallback-seed 表示
- **中立（foreground / background ＋ opacity）**: それ以外すべて

`--color-state` は追加しない（ユーザー判断）。state 用途は中立色で代替している。

## 欠損・ゼロ値・長文への耐性
- `DetectionMeter`: `clamp01` で NaN・範囲外・undefined 経由の NaN を 0〜1 に丸め、バーが壊れない。
- `AttackPatternCard`: `Chips` は空配列なら「なし」を中立色で表示。intensity は `IntensityDots` 内で
  `Math.round` ＋ 0〜3 クランプ。`channel` / `sourceContext` / enum 値は `break-all` / `break-words`
  で長文折り返し。`parentId` 無しは系統表示を出さない。
- `ToolSelectionLog`: `logs` 空なら「調査ログがありません。」。`round` が飛んでも昇順グルーピング。
  `TOOL_LABELS[name] ?? name` で union 外の値が来ても素のキー名で落とさず表示。

## 型の取り回し
- `AttackPatternCard` は `@/types/attackPattern` の `AttackPattern` をそのまま受け取る。
- `ToolSelectionLog` の `toolName` は `@/types/investigation` の `ToolName` union（8-B で追加）を参照し、
  `TOOL_LABELS: Record<ToolName, string>` で網羅を型で強制。
- `DetectionMeter` は表示専用の `DetectionMeterProps { recall; fpr }`（lib の RoundMetrics とは別物）。

## テスト方針（8-C1 と同一・ユーザー承認済み）
- 完了扱いの基準: **tsc green ＋ 各コンポーネントが MOCK データで単独 import 可能**。
- jsdom / @testing-library の導入は本タスクのスコープ外（既存テスト基盤は `environment: "node"`・
  `*.test.ts` のみで .tsx 描画テストの基盤が無い）。
- **描画の最終目視はブラウザで行う**: `npm run dev` 後、8-C3 で `/demo` ルートに組み込んでから
  確認する。この環境ではブラウザ確認を実施できていないため、描画の目視確認は未完
  （コード・型のみ green）である点を明記する。

## 完了確認
- `npx tsc --noEmit` → exit 0
- `AttackPatternCard` / `ToolSelectionLog` / `DetectionMeter` および各 MOCK が単独 import 可能

## やっていないこと（後続）
- デモページへの組み込み・ループとの実データ接続（Task 8-C3）
- ブラウザでの描画目視（dev サーバ／8-C3 組み込み後）

# Task 8-C3: デモページ レイアウト統合

実施日: 2026-06-04

8-C1（MetricsChart）/ 8-C2（カード・ログ・メーター）の純表示部品を `/demo` ページに組み込み、
「ループ開始」→ ラウンドごとの更新 → 承転結が撮れる状態にした。

## 追加ファイル
- `src/app/demo/page.tsx`（新規）— Server Component。倫理声明バナー（仮）＋見出し＋レイアウト＋DemoController
- `src/app/demo/_components/DemoController.tsx`（新規）— `"use client"`。開始ボタン＋polling 制御＋4部品への配線
- `src/app/demo/actions.ts`（新規）— `"use server"`。`runDemoRound(round)`（薄いラッパ）
- `src/app/demo/_loop.ts`（新規・純粋）— シナリオ `DEMO_ROUNDS`＋変換関数＋`buildDemoRound`＋型
- `src/app/demo/__tests__/demo.test.ts`（新規）— 変換関数・buildDemoRound・承転結アークの単体テスト（14本）

## 設計判断

### 1. データ取得方式: polling（1ラウンド = 1 Server Action 呼び出し）※ユーザー指定
streaming は不採用（Cloud Run のタイムアウト・Next.js 16 の安定性を考慮、ユーザー指定）。
クライアント（DemoController）が round 番号と累積点を保持し、`done`/`detected` まで
`runDemoRound(round)` を逐次呼び出す。ラウンド間に `ROUND_DELAY_MS = 800ms` のウェイトを入れ、
承→転→結の遷移を目視/録画できる速さにした。

### 2. 状態保持: クライアント保持 ※ユーザー指定
Server Action は本来ステートレス。ラウンド間状態をサーバセッションに持つと Cloud Run の
複数インスタンス/再起動で消えるため、状態はクライアントが持ち round を引数で渡す方式にした。

### 3. データ源: スクリプト化デモ ※ユーザー指定
実 Gemini/Vertex は呼ばず、決定論的な6ラウンドのシナリオ（`DEMO_ROUNDS`）で承転結アークを
再現する。Vertex 認証不要・高速・再現性ありで「撮れる」状態を保証する。
- 承: 第1ラウンド = Gen1（系統なし）、recall 低（0.2）、未検知。
- 転: 型が channel/レバーを変えて変異（email→sms→line）しつつ、防御が呼ぶ調査ツールを
  増やして学習（呼び出しツール数 2→5、coverage 単調増 0.30→0.85）。recall はギザギザ。
- 結: 第6ラウンド = recall 高（0.9）で回復、現ラウンドの型を検知（detected=true）。

### 4. 実型経由（後続の実ループ差し替えを機械化）
シナリオは `RoundRecord` 相当（AttackPattern / InvestigationReport / RoundMetrics）の実型で組み、
変換関数（`reportToToolLogs` / `metricsToPoint` / `metricsToMeter`）を介して各部品へ渡す。
実 `runLoop` へ差し替える際は `buildDemoRound` のデータ源を替えるだけで、変換・契約は再利用できる。

### 5. "use server" と純関数の分離
`"use server"` ファイルは全 export が async Server Action でなければならない制約があるため、
同期の純関数（変換・シナリオ・`buildDemoRound`）は `_loop.ts`（無印モジュール）に集約し、
`actions.ts` は `runDemoRound` だけを薄く置いた。これによりロジックを node 環境の vitest で
直接テストできる（`_loop.ts` は型のみ import なので recharts 等の client 依存を実行時に巻き込まない）。

### 6. データ接続マッピング（タスク指定どおり）
- AttackPatternCard ← 現ラウンドの `pattern` / `generation`
- DetectionMeter ← 現ラウンドの `metrics`（Ratio の null は 0 に変換）
- ToolSelectionLog ← 各ラウンドの `InvestigationReport` を `reportToToolLogs` でログ化（累積表示）
- MetricsChart ← 全ラウンドの `RoundMetricsPoint[]`（coverage はシナリオ供給）

### 7. 色は役割トークンのみ
開始ボタン = `bg-brand`（プロダクト基調 / プライマリ CTA）、完了表示 = `text-action`、
エラー/倫理声明バナー = `warning`。ハードコード色なし。

## テスト方針（8-C1/8-C2 と同一・ユーザー承認済み）
- 完了扱いの基準: **tsc green ＋ vitest green ＋ next build 成功**。
- 純関数（変換・シナリオ・buildDemoRound）は node 環境の vitest で単体テスト（14本追加）。
- jsdom / @testing-library は範囲外（コンポーネント描画テストの基盤が無い）。
- **描画・操作の最終目視はブラウザで行う**: `npm run dev` → `/demo` で「ループ開始」を押し、
  カード/メーター/ログ/グラフがラウンドごとに更新され、承→転→結の3フェーズが見えることを確認する。
  この環境ではブラウザ確認を実施できていないため、描画・操作の目視確認は未完（コード・型・
  ビルドのみ green）である点を明記する。

## 完了確認
- `npx tsc --noEmit` → exit 0
- `npx vitest run` → 176 passed / 6 skipped（デモ14本追加・回帰なし）
- `npx next build` → 成功（`/demo` ルート生成、RSC 境界 server page / "use client" controller /
  "use server" action が正しく構成されることを確認）

## やっていないこと（後続）
- モード分離・倫理声明の正式実装（Task 8-D）
- デプロイ設定変更
- 実 runLoop（Gemini/Vertex）との接続（本タスクはユーザー指定でスクリプト化デモ）
- ブラウザでの描画・操作目視（dev サーバ）

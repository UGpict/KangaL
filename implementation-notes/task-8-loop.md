# Task 8-A: 攻防ループ制御・集計（loop.ts）

`runLoop` を実装し、攻撃⇄防御のオーケストレーション（生成→調査→判定→集計→進化）
と、ハード制限・evolve 契約・per-round メトリクス集計の正しさをテストで固めた。
エージェント本体（generateAttackPattern / investigate / judge / evolve）は本タスクでは
全てモック注入で差し替え、ループ制御と集計ロジックのみを検証している。

## 追加・変更ファイル
- `src/agents/loop.ts`（新規）— runLoop 本体・型
- `src/agents/__tests__/loop.test.ts`（新規）— 必須4テスト
- `src/lib/metrics.ts`（変更）— `recordRound` / `RoundMetrics` を追加（集計の正本）

## 設計判断

### 1. ADK は導入せず、ハンドロールの逐次ワークフローにした
仕様は「★ADK をここで初めて導入する」と書いていたが、以下の理由で**ADK 採用を保留**し、
ADK 形（= 固定ワークフロー＋差し替え可能なエージェント単位）の構造だけを踏襲した。

- ADK パッケージは未インストール（package.json / node_modules に存在せず、依存は `@google/genai` のみ）。
- 攻防の大枠（生成→調査→判定→進化）は完全に決定的な逐次フロー＝ただの for ループ。
- 唯一の動的判断（調査フェーズ内のツール選択）は Task 6 の function-calling ルータ
  （investigate.ts）に既に委譲済みで、§6-4 が「ADK から直接触らない」と明記している。
- リポジトリ全体が `@google/genai` 直叩きでオーケストレーションをハンドロールしており、
  ここだけフレームワークを足すと一貫性を欠き、得るものが無い。

→ エージェントを `LoopAgents`（差し替え可能ユニット）として固定ワークフローの背後に置いたので、
将来 ADK へ載せ替える場合も機械的な置換で済む。判断はユーザー承認済み。

### 2. メトリクスは「注入可能なサンプル集合 + recordRound」方式
FPR は良性サンプルが無いと意味を持たない（§7「良性サンプル必要」）。一方 `judge` は
攻撃パターン（レバー）を採点し `LoopOptions` にサンプル入力が無かった。承認を得て次の構成にした。

- `LoopOptions.samples?: Sample[]` を追加。各ラウンドの Judged 集合は
  **「その世代の攻撃パターン（必ず scam として1件）＋ samples を judgeSample で採点した分」**。
  これにより recall（進化する型を捕まえたか）と fpr（良性ベースラインを誤検知したか）の
  両軸がラウンドごとに算出できる。
- `recordRound(judged, threshold): RoundMetrics` を metrics.ts に新設（= 本タスクの「集計」成果物）。
  既存の `recall` / `fpr` を束ねるだけの純関数で、単体テスト容易。
- `LoopAgents.judgeSample` は良性/追加 scam サンプルをラウンドごとに採点する注入口。
  デフォルトは中立プレースホルダ（score 0）。本文（messageBody）採点の実パスは 8-A 範囲外
  （「エージェント本体の変更」をしないため）なので、実配線は後続タスクに委ねる。

### 3. evolve はハード制限の最終ラウンドでは呼ばない
すり抜けても **次ラウンドが実際に子を消費するときだけ** evolve する（`round < maxRounds`）。
maxRounds 到達で捨てる型を無駄に進化させない。Task 7 の契約どおり evolve には常に
`{ detected: false }` のみを渡す（detected=true を渡すと throw する契約）。

### 4. missedBy は defender→attacker 接続しない（8-B 範囲）
本タスクでは feedback に missedBy を載せず、evolve は固定ラダー経路を通る。

## メトリクス契約の要点
- `RoundMetrics = { recall: Ratio; fpr: Ratio }`（`Ratio = number | null`）。
  分母0（scam/benign 不在）は 0 ではなく null で「算出不能」を表す（既存 metrics.ts の規約踏襲）。
- recall は「そのラウンドの scam 群を threshold 以上に採点できた割合」。サンプル無指定なら
  攻撃パターン1件のみが分母 → recall は実質 detected の 0/1 反映。
- threshold は `getDetectionThreshold()`（env `KANGAL_DETECTION_THRESHOLD`、既定70）。

## テスト（4 必須・全 green）
1. すり抜け→学習→回復: judge スコア [50,60,90] → detected [false,false,true]、
   rounds.length===3、各ラウンド metrics 記録、recall 推移 [0,0,1]（[低,低,高]）。
2. maxRounds ハード制限: 全すり抜け・maxRounds=3 → rounds.length===3、finalDetected===false。
3. FPR 低位安定: 良性10件中1件のみ誤検知 → 全ラウンド fpr===0.1 ≤ 0.1、recall は [0,1] と上昇。
4. evolve 契約: [false,true] で evolve は1回・常に `{detected:false}` で呼ばれ、捕捉ラウンドでは呼ばれない。
   初回捕捉 [90] では evolve 0 回。

## 完了確認
- `npx vitest run src/agents/__tests__/loop.test.ts` → 4 passed
- `npx tsc --noEmit` → exit 0（型エラー無し）
- 全体 `npx vitest run` → 159 passed / 6 skipped（integration gated）、回帰なし

## やっていないこと（後続タスク）
- ~~missedBy の defender→attacker 接続（8-B）~~ → Task 8-B で接続完了（下記）
- 良性 messageBody 採点の実パス配線（judgeSample デフォルトはプレースホルダ）
- UI（8-C 以降）／エージェント本体の変更／ADK フレームワーク本採用

---

# Task 8-B: missedBy 生産/消費契約の接続（Task 7 からの持ち越し解消）

実施日: 2026-06-04

Task 7 で「Task 8 で接続保証」としていた missedBy の生産/消費契約を実際に配線した。
defender（investigate→report）が埋める missedBy を detectionResult へ引き継ぎ、
attacker（evolve）がそれを読んで誘導変異する経路を loop.ts に接続した。
8-A の「missedBy は defender→attacker 接続しない（8-B 範囲）」を解消。

## 採用方針: 案B（生産=配列 / 消費=単一、loop が橋渡し）
設計分岐をユーザーに確認のうえ案Bを採用（消費側の改修を最小化）。

- **生産側は ToolName[]**: 一度の調査で複数ツールが死角になり得るため配列が自然。
  - `src/types/investigation.ts`: `ToolName` union を定義（`"urlReputation" | "senderAuth" | "officialAlerts" | "domainAge" | "knownScams"`、= report の finding キー）。`InvestigationReport.missedBy?: ToolName[]` を追加。
  - `src/types/attackPattern.ts`: `detectionResult.missedBy` を `string` → `ToolName[]` に厳格化（ToolName を investigation.ts から import。investigation.ts は無 import のため循環なし）。
- **消費側は単一 string 据え置き**: evolve の `DetectionFeedback.missedBy` は1方向誘導の switch 設計なので単一のまま（ToolName ⊂ string）。既存 attacker.test.ts の evolve テスト群・smoke は無改修。
- **橋渡しは loop**: `loop.ts` が `detectionResult.missedBy?.[0]`（先頭1件）を取り出して `evolve(pattern, { detected: false, missedBy: firstMissed })` に渡す。missedBy 無し→undefined→evolve は固定ラダー経路。

## なぜ ToolName union 化（Task 7-V1 の ⚠️ 解消）
missedBy が素の `string` だと、攻撃側へ実在しないツール名が流れても型で気づけない。
ToolName union に閉じることで「missedBy に入るのは実在 5 ツール名のみ」を tsc で物理担保。

## investigate 本体は無改修（フィールド追加・配線のみ）
タスク制約どおり「どのツールが寄与しなかったか」の**算出ロジックは未実装**。
`missedBy?` はオプショナルなので investigate は当面 undefined を返す（型は満たす）。
実環境では evolve は固定ラダー経路、test では mock が missedBy を注入して配線を検証する。

## 変更ファイル
- `src/types/investigation.ts` — ToolName 定義・InvestigationReport.missedBy 追加
- `src/types/attackPattern.ts` — detectionResult.missedBy を ToolName[] に
- `src/agents/loop.ts` — detectionResult への引き継ぎ＋先頭1件を evolve へ橋渡し
- `src/agents/attacker.ts` — DetectionFeedback コメントを橋渡し方針に更新（型は据え置き）
- `src/types/__fixtures__/attackPattern.example.ts` — 無効値 `"v0-defense"` → `["urlReputation"]`
- `src/agents/__tests__/attacker.test.ts` — detectionResult フィクスチャ1行を `["senderAuth"]` に（生産側型厳格化に伴う必須修正・evolve 呼び出しは無変更）
- `src/agents/__tests__/loop.test.ts` — missedBy 配線テスト＋型レベルガード追加
- `docs/design-v0.1.md` §5 — 正本同期（detectionResult.missedBy を ToolName[] に）

## 追加テスト（loop.test.ts）
1. **missedBy 配線**: investigate が `["urlReputation","senderAuth"]` を返す → evolve が `{ detected: false, missedBy: "urlReputation" }`（先頭1件）で呼ばれる spy 検証。detectionResult には配列全体が引き継がれることも assert。
2. **missedBy 無し**: stubReport（missedBy 無し）→ feedback は `{ detected: false }`（先頭取り出しが undefined）。
3. **型レベルガード**: `@ts-expect-error` で `["notATool"]` が `ToolName[]` に代入不可なことを tsc で担保（緩ければコンパイル失敗）。

## 完了確認
- `npx tsc --noEmit` → exit 0（ToolName union による型エラー無し・@ts-expect-error 有効）
- `npx vitest run` → 162 passed / 6 skipped（integration ゲート・回帰なし）
- 中間確認: フィクスチャ修正後に vitest を1回走らせ連鎖失敗ゼロを確認してから後続手順へ進めた。

## やっていないこと
- missedBy の算出ロジック（どのツールが寄与しなかったかの判定）— investigate/judge 本体は無改修
- UI（8-C 以降）

---

# Task 8-D: モード分離 + 倫理声明

実施日: 2026-06-04

攻撃エージェントをデモ/研究モード限定に閉じ込め（DEMO_MODE 限定）、倫理声明を正式実装した。
これで Task 8（攻防ループ + 可視化 + ガード）の記録を完結とする。

## 追加・変更ファイル
- `src/lib/demoMode.ts`（新規）— `isDemoMode()` / `assertDemoMode()` / `DEMO_MODE_DISABLED_MESSAGE`
- `src/proxy.ts`（新規）— `/demo` を DEMO_MODE 未設定時に 403 で遮断（Next 16 の middleware＝proxy）
- `src/app/demo/_components/EthicsDisclaimer.tsx`（新規）— 常時表示・折りたたみ不可の倫理声明
- `src/lib/__tests__/demoMode.test.ts`（新規）— 有効/無効・assert・runLoop 例外のテスト
- `src/agents/loop.ts`（変更）— `runLoop` 先頭で `assertDemoMode()`
- `src/app/demo/actions.ts`（変更）— `runDemoRound` 先頭で `assertDemoMode()`（多層防御）
- `src/app/demo/page.tsx`（変更）— 仮バナーを `<EthicsDisclaimer/>` に置換
- `src/app/demo/_components/DemoController.tsx`（変更）— 冒頭（開始前）・末尾（完了後）の研究目的声明
- `src/agents/__tests__/loop.test.ts`（変更）— 新ガード下で通るよう DEMO_MODE=true を beforeAll/afterAll で設定

## モード分離方針
単一の判定点 `isDemoMode()`（`process.env.DEMO_MODE === "true"` のみ有効、フェイルセーフ）を
3層で適用する多層防御:
1. **ルート（proxy.ts）**: `/demo` と `/demo/:path*`（ページ表示・Server Action の POST を含む）を
   DEMO_MODE 未設定時に本物の 403 で遮断。
2. **オーケストレーション入口（runLoop）**: 攻撃エージェントを駆動する `runLoop` の先頭で
   `assertDemoMode()`。無効時は `"Demo mode is disabled"` を throw して一切実行しない。
3. **デモ Server Action（runDemoRound）**: proxy を経由せず直接 POST されうるため、ここでも
   `assertDemoMode()`。

### 攻撃エージェント本体は直接ガードしない判断
`generateAttackPattern` / `evolve` 自体には例外を入れず、オーケストレーション入口（runLoop・
デモ Action・ルート）で閉じ込めた。spec が例外を求めるのは runLoop のみで、agent 単体テスト・
smoke スクリプトを壊さないため。攻撃側が「動く」経路は実質 runLoop / デモ経由に限られる。

### Cloud Run（本番）デフォルト無効
本番環境変数に DEMO_MODE を設定しない＝デフォルトで全層が無効（403／例外）。セキュアデフォルト。

### 403 手段の選択
`forbidden()` は experimental（要 `authInterrupts` フラグ＋規約ファイル）のため不採用。安定して
本物の 403 を返せる proxy.ts を採用した（"403 or リダイレクト" の指定に対し 403 を選択）。

## 倫理声明の配置
- **常時表示の正式声明（EthicsDisclaimer）**: ページ最上部、warning 色 2px ボーダー、折りたたみ不可。
  文言は要件で固定（研究・教育目的／抽象的な型のみ／実詐欺文は生成・保存しない／悪用禁止）。
- **冒頭声明**: DemoController が idle のとき、開始操作の near に研究目的のシミュレーションである旨。
- **末尾声明**: 完了（done）後、抽象的な型であり実詐欺文は生成・保存していない旨を再掲。

## 完了確認
- `npx tsc --noEmit` → exit 0
- `npx vitest run` → 181 passed / 6 skipped（demoMode 5本追加・回帰なし）
- dev サーバ実機確認:
  - DEMO_MODE 無し → `GET /demo` が **HTTP 403**
  - `DEMO_MODE=true` → `GET /demo` が **HTTP 200**（ループ開始ボタン・倫理声明・冒頭声明を確認）

## やらないこと（spec どおり）
- 認証・ログイン機構の追加
- Teams/Slack/メールのリアルタイム監視（将来構想）

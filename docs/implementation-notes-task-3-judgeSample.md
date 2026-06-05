# Implementation Note — T3 judgeSample 配線（placeholder 解消）

作成: 2026-06-05 / 対象: PLAN-v2 §2 T3 / 正本: `docs/STATUS.md` + `docs/PLAN-v2.md`

## 1. やったこと（配線の内容）

`runLoop` の `DEFAULT_AGENTS.judgeSample` を **placeholder（`score:0` 固定, 旧 `loop.ts`）から本判定へ配線**した。

- 追加: `judgeSampleViaPipeline(sample)`（`src/agents/loop.ts`）。
  - `sample.messageBody` を **既存の paste パイプライン** `analyzeStructure` → `investigate` → `judge` に通す（`src/app/api/judge/route.ts:51-63` と同経路）。**新規パイプラインは作っていない。**
  - 道B: 受け取るのは `Sample`（`{ kind; messageBody }`）のみ。詐欺の自由文の生成・保存はしない。Sample が levers を持たない（pattern 経路と違う）ため、まず `analyzeStructure` で構造分解する点だけが pattern 経路との差。
  - `analysis.degraded`（Gemini 失敗）→ `score:0`（判定保留＝非検出）。route.ts の degraded 分岐に揃えた。
  - `round` 引数は本体では未使用だが agent シグネチャに残した。**理由**: `investigate` が育つ `attackPatterns` コーパスを読むため、ラウンドごとの再採点は意味を持つ（閉ループ T2/V2）。
- `DEFAULT_AGENTS.judgeSample: (sample) => judgeSampleViaPipeline(sample)`。

### 二重定義を作っていないことの確認
- 閾値・スコアリングは **judge の既存実装を再利用**。`judgeSampleViaPipeline` は judge の 0-100 score をそのまま返すだけで、独自の閾値ロジックを持たない。
- recall/FPR 側（`metrics.ts` の `recall`/`fpr`/`evaluateSamples`）は `getDetectionThreshold()`（既定 70）で `score >= threshold` 判定する。loop の pattern 判定（`loop.ts` の `score >= threshold`）と**同一の閾値・同一スケール**。danger/safe 境界は `getDetectionThreshold()` の 1 箇所のみ。

## 2. テスト（実 Gemini / Firestore からの保護）

`src/agents/__tests__/judgeSample.test.ts` を追加（T2-② の persistPattern を `vi.fn()` で守ったのと同作法）。

- `analyzeStructure`（レバー抽出に Gemini を使う非決定部）を mock → 固定レバーを返す。
- `investigate`（ツール選択に Gemini/firestore を触る）を mock → 空レポート（bonus total 0）。
- `@/lib/gemini.generateJson` を mock し reject。実 `judge` は理由文を FALLBACK に落とすが **score は `computeScore` の決定論値**（investigation bonus=0）。

既存テスト（`loop.test.ts` など）は従来どおり `makeAgents` でモックを注入するため、本配線の影響を受けない。

実行結果: 全スイート **190 passed / 6 skipped**、`tsc --noEmit` クリーン。

## 3. 実測値（明確サンプル・決定論部）

すべて **決定論部（レバー素点ベース, investigation bonus=0）** の実測。閾値 = `getDetectionThreshold()` = 70。

| サンプル | レバー構成（要点） | score | 判定 |
|---|---|---|---|
| 強い詐欺 | urgency3 / authority(financial,3 trick) / incentive3 / cta=transfer_money,low / personalization=targeted+signal / isolation0 | **71** | 検出（≥70） |
| 明確な良性 | 全レバー不立（cta=click_link,high で素点0） | **0** | 非検出（<70） |

スコア導出（決定論）: raw = 6+6+6+9+9+0 = 36, maxRaw = 3×17 = 51, linear = round(36/51×100) = **71**。isolation=0 なので floor 経路を通らず線形和のみで閾値超え。

`evaluateSamples`（詐欺2 + 良性2 の小集合, judgeFn = `judgeSampleViaPipeline`）:

- **recall = 1.0**（2/2）
- **fpr = 0.0**（0/2）
- scamTotal=2, benignTotal=2

→ **縮退（recall=0 / fpr=1）でない**。詐欺は検出側・良性は非検出側に分かれ、placeholder の `score:0` 固定（両者同値）が解消されたことを確認。

## 4. 決定論 / 非決定の切り分け（誤読防止）

- 上記の実測は **決定論部のみ**（analyzeStructure を固定レバーで mock、investigation bonus=0）。「配線が効いて、明確サンプルで recall/FPR が動く」という **T3 の合否はここで判定済み**。
- **非決定が乗る部分は本ノートの実測に含めていない**:
  - investigation bonus の非決定的ばらつき（T2-② で dip 49→41 の正体だったもの）は、`investigate` を空レポートに mock したため載っていない。
  - 実 Gemini によるレバー抽出（`analyzeStructure` 本体）の揺れも、mock したため載っていない。これは INTEGRATION 経路（実 Vertex 認証必要）で、T5/実走の領域。
- **subtle BEC（score 49〜55 帯）の取りこぼし**（診断で 3 seed 確認済みの現検知器の盲点）は **T3 の合否には使っていない**。T3 の検証はばらつきの少ない明確サンプル（強い詐欺・明確な良性）に限定した。境界帯は T5/T2-③ で扱う。

## 5. 後続への引き継ぎ

- T5（外部ホールドアウト評価）: `evaluateSamples` の judgeFn に `judgeSampleViaPipeline` を渡せば、攻撃側未見のホールドアウト集合に対する holdout recall を算出できる（PLAN-v2 V4・T5 のハーネス (ii)）。
- T2-③（暗記 vs 汎化）: in-loop recall（暗記込み）と holdout recall（汎化）の両取りに、本配線の judgeFn を使う。

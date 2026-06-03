# Task 3 — 防御エージェント：判定＋日本語説明＋スコア（③）

実施日: 2026-06-03(v1)、同日改修(v2 — レビュー反映)

## 何を
- `src/lib/weights.ts`: `LEVER_WEIGHTS` / `CTA_DANGER` / `FRICTION_ADJ` / `PERSONALIZATION_LEVEL_RANK` / **`ISOLATION_FLOORS`** / `maxRawScore()`。
- `src/agents/judge.ts`:
  - `JudgeResult = { score, reason, isolationNote: string | null }`
  - `computeScore(levers)`: 線形加重和を `max(linear, ISOLATION_FLOORS[isolation.intensity])` で底上げ
  - `judge(levers)`: Gemini で reason を生成、`isolationNote` は別フィールドで契約保証
- 単体 16 件 + 統合 1 件のテスト。実 Vertex AI で 92 / 統合通過。

## なぜ(v2 改修の論点)

### v1 の致命傷
v1 はリニア加重和を maxRawScore で割って 0-100 にしていた。これだと
**isolation 単独・intensity 3 = 15/51 = 29 点**で、§5「単独で強い赤信号」が出ない。BEC テストが偶然通っていたのは fixture が6レバー全部立てていたから(現実の検算で BEC 3レバーだけだと 59 で閾値 70 に届かない)。

→ **`ISOLATION_FLOORS = {0:0, 1:0, 2:55, 3:75}`** を導入。`computeScore = max(linear, floor)`。
- isolation 単独 intensity 3: max(29, 75) = **75** → §5 の「単独で赤信号」が成立
- isolation 単独 intensity 2: max(20, 55) = **55** → 警告域
- isolation 単独 intensity 1: max(10, 0) = **10** → 弱シグナル、floor 効かず
- BEC 6レバー全立て: max(92, 75) = **92** → リニアが勝つ(自然な合算)

「重みだけで説明できる」シンプルさは失うが、§5 の「単独で支配」と「他と素直に合算」を両立する素直な妥協点。

### CTA 強度クランプ(双方向)
- v1 は下端のみ `Math.max(0, …)`。上端 `Math.min(3, …)` も追加(現状の DANGER/FRICTION_ADJ では上端は 3 を超えないが、将来テーブル編集時の安全網)。
- 加えて `CTA_DANGER[action] ?? 0` / `FRICTION_ADJ[friction] ?? 0` でレスポンススキーマを通り抜けた off-enum 値にも防御。defense-in-depth。

### friction = high は良性とは限らない
- weights.ts の `FRICTION_ADJ` 上にコメント明記。「正規依頼ほど手間/検証が多い」の代理変数として使っているが、**手の込んだソーシャルエンジニアリングは高フリクション**(多段階の信頼構築)で正規を装えるため、Task 5 で実サンプルに対して検証する。

### `isolationNote` 分離 — 文字列いじりから契約を切り離す
v1 は reason に canonical 注記を自動追記していた。問題:
- Gemini が「孤立化」を別文脈で使うと文字列マッチが効き、肝心の canonical 注記文をスキップして安全メッセージが失われる
- 日本語段落に後付け文を継ぐとトーンの継ぎ目が出る(§7 の「2-3 文・優しく」に逆行)
- プロンプトは「孤立化を含めて」要求しているが、テストは「孤立化」文字列だけを見る軽い不整合

→ v2 で `JudgeResult.isolationNote: string | null` を新設。
- isolation.intensity > 0 → canonical 注記文をそのままセット
- それ以外 → null
- reason は Gemini の出力をそのまま返す(文字列連結なし)
- SYSTEM_INSTRUCTION から「孤立化を必ず含めて」指示を削除(分離した契約と整合)

UI(Task 4) は `isolationNote != null` を見て別領域に表示する。文字列ハック消滅、テストは `isolationNote.includes("孤立化")` で素直、トーンも崩れない。

### Prompt Injection 面の実体
`pickActivePayload` が出す JSON は **enum 文字列 / 整数 / boolean のみ**。
- 各レバーのキー: `tactic` / `intensity` / `impersonates` / `credibilityTricks` / `type` / `hook` / `action` / `friction` / `level` / `signals` — すべて型レベルで enum か数値に縛られている
- 生文字列(message body 等)は judge() に入ってこない設計(judge は levers のみ受け取る)

→ **構造的に注入面ゼロ**。`<untrusted_input>` ラッパは「将来うっかり自由テキストフィールドを足したときの保険」(defense-in-depth)。コードコメントに明記。テスト「payload contains no free-text fields」で enum/整数しか出ていないことを再帰的に assert。

### exact-score テスト
v1 は `≥ 70 / < 30` の閾値アサート。重みや正規化がズレてもサイレントに通る。v2 は **`expect(score).toBe(92)` などの完全一致**に変更。校正で計算が動いたら即座に回帰が見える。

## どう

### スコア検算(v2)
```
weight: { urgency:2, authority:2, incentive:2, callToAction:3, personalization:3, isolation:5 }
Σweight = 17, maxRaw = 51

BEC (all 6 active, intensity 3 中心):
  strength = [urg 3, auth 2, inc 2, cta 3, pers 3, iso 3]
  raw = 6+4+4+9+9+15 = 47
  linear = round(47/51*100) = 92
  floor(iso=3) = 75
  score = max(92, 75) = 92 ✓

isolation-only iso=3:
  strength = [0,0,0,0,0,3]
  raw = 15, linear = 29
  floor = 75
  score = 75 ✓

isolation-only iso=2:
  raw = 10, linear = 20, floor = 55, score = 55 ✓

isolation-only iso=1:
  raw = 5, linear = 10, floor = 0, score = 10 ✓

benign (all none/0/high):
  raw = 0, linear = 0, floor = 0, score = 0 ✓
```

### コメント方針(v2 で増えた箇所のみ)
- `weights.ts`:
  - `FRICTION_ADJ` 上に「high friction が常に良性ではない」注記(校正時の地雷予防)
  - `ISOLATION_FLOORS` 上に「§5 単独で赤信号を線形和で表現できない」理由
- `judge.ts`:
  - `strengthOf` の上に「CTA は両端クランプ + `?? 0` 防御」
  - `wrapUntrusted` の上に「payload は enum/整数のみ、注入面ゼロ、ラッパは defense-in-depth」

## 確認した完了条件(v2)
- [x] `npx tsc --noEmit` エラーゼロ
- [x] `npx vitest run`(単体)23 passed(Task 2 と合算)
- [x] `INTEGRATION=1 ...`(統合含む)26 passed(Task 2 ×2 + Task 3 ×1)
- [x] BEC サンプル: **score === 92**(exact-score テスト緑、統合の実 Gemini でも 92)
- [x] 良性サンプル: **score === 0**(exact-score テスト緑)
- [x] BEC サンプルの `isolationNote` に canonical 注記文(「孤立化」「内密」両方含む)
- [x] 良性サンプルの `isolationNote === null`
- [x] reason は Gemini の出力をそのまま返す(連結なし)

## §5 設計穴の決着(Task 5 以降の前提)
- `incentive.type` / `callToAction.action` に "none" enum が無い問題: 判定ロジック側で吸収(intensity:0 / friction:"high" を「効いていない」の正式表現)。
- **設計ドキュメントは現状維持**。Task 2 申し送りで宙吊りだった判断は本タスクで決着。

## 重み・フロアについて(未校正の初期値)
- `LEVER_WEIGHTS` / `ISOLATION_FLOORS` / `CTA_DANGER` / `FRICTION_ADJ` すべて **未校正の初期値**。
- 良性サンプル収集後(§13 / Task 5)に再調整する前提。`weights.ts` が **唯一の触りどころ**(judge.ts のロジックは触らずに済む構成)。
- 特に再評価すべき:
  - **isolation floor**: 正規の社内メールで isolation が誤って立つケースが多ければ 55/75 は誤検知源。
  - **friction = high**: 良性扱いの仮定が成り立つか。
  - **重み比 isolation:5**: §5 思想を反映しているが、データで検証していない。

## やらなかったこと(意図的にスコープ外)
- UI 表示(Task 4)
- 調査ツール(②)呼び出し
- analyzeStructure と judge の連結
- 重み校正(良性/詐欺サンプル収集後)
- few-shot プロンプト追加(現状で統合テスト通過)

## 次タスクへの申し送り

### Task 4(UI)
- 入力 message → `analyzeStructure(message)`
  - `degraded:true` → 「判定保留」表示(レバー値を読まない)
  - `degraded:false` → `judge(result.levers)` → `{ score, reason, isolationNote }` を表示
- UI 側の表示構造:
  - **score**: 「危険度 92/100」のような大表示
  - **reason**: Gemini の自然文をそのまま 2-3 文ブロックで
  - **isolationNote**: 別領域(コールアウトや注記ボックス)で `isolationNote != null` のときのみ表示。Gemini 本文とトーンが違うので視覚分離が大事

### Task 5(メトリクス)
- 良性サンプル収集後、`computeScore` を全サンプルで回して FPR 測定。
- 重み・フロア・friction の良性扱いを実データで検証。`weights.ts` を一箇所いじるだけで効く構成。
- 校正したら exact-score テストの期待値も更新する必要あり(`92 → ??`)。テストが赤くなるのが「ズレに気づける」シグナル。

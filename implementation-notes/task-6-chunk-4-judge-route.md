# Task 6 — Chunk 4: judge 連携 + スコアリング

## 何を
- `src/lib/weights.ts` 拡張: `computeInvestigationBonus()` 純関数と関連定数(`BONUS_*` / `INVESTIGATION_BONUS_CAP`)を追加。
- `src/agents/judge.ts` 拡張: `judge(levers, investigation?)` シグネチャ、`JudgeResult` に `investigationBonus: InvestigationBonus` 追加、score 式に bonus を加算、Gemini プロンプトに `investigation_findings` を投入。
- `src/app/api/judge/route.ts` 拡張: degraded で短絡、それ以外は `analyzeStructure → investigate → judge(levers, investigation)` の3段、`authenticationResults` をリクエストから受け取って investigate に渡す。レスポンスに `investigationBonus` と `investigation` を露出。
- `src/agents/__tests__/judge.test.ts` 拡張: 16 件追加(各 bonus シグナル / cap / 後方互換 / 内訳 / 加点専用)。
- `src/agents/__tests__/investigate.integration.test.ts` 新設: BEC を実 Gemini に投げて動的ルーティングを実機検証。
- 結果: typecheck green / 単体 **114 passed**(98 → 114、+16 件)/ 統合含めて **118 passed**(統合は analyze ×2 + judge ×1 + investigate ×1)。

## なぜ

### bonus 定数化と純関数切り出し
- レビュー指摘「マジックナンバー禁止 / cap=+25」を反映。各シグナル値と cap を `weights.ts` に名前付き定数で固定。
- `computeInvestigationBonus(report)` は純関数で `InvestigationBonus` を返す。これにより:
  - UI / テストから内訳を構造的に取れる
  - judge 本体の責務(score 計算 + reason 生成)から bonus 計算が分離
  - 重み調整が weights.ts 1 ファイルに収束

### 加点専用(asymmetric)を明文化
- 構造分解で黒っぽい(score 高い)が調査がシロ(ドメイン古い / 認証 pass / Web Risk クリア)でも、**score は下がらない**。
- セキュリティ用途で false-negative 回避を優先する設計判断。`weights.ts` のコメントとテスト(「all error findings contributes 0」「benign senderAuth contributes 0」)で明示。
- 将来良性側コーパスが充実したら再評価する余地は残す。

### score 式の決定値
```
score = min(100, max(linear, isolationFloor) + investigationBonus.total)
```
- `max(linear, isolationFloor)` までは Task 3 の挙動を完全保持(後方互換)
- bonus 加算と 100 cap は **追加層**
- `investigation=null/undefined` で `bonus.total === 0` になるので、Task 3 のテスト fixture(BEC=92, benign=0, isolation alone i=3 → 75, etc.)が**すべてそのままパス**

### cap=+25 と「2本で天井」の意図
- 個別合計は 56(15+10+8+15+8)。実際の cap は +25。
- 「強シグナル 2 本(例: Web Risk+ドメイン新規 = 25)で天井に達する」は **意図的な設計選択**(Chunk 4 設計レビュー時に明示)。階調を見せたいなら cap を上げるか個別重みを下げるが、MVP では「強シグナルは束ねて評価」を優先。
- テスト「all 5 signals → total === 25, capped === true」で天井動作を assert。

### Gemini プロンプトに `investigation_findings` を入れる理由
- reason 生成時に「ドメインが3日前に登録された」「Web Risk が SOCIAL_ENGINEERING と判定」を具体名で伝えられる。
- 立っていないレバーの作話禁止と同じく、**findings に無い情報は書かない**を system instruction に明記。
- 外部由来テキスト(`officialAlerts.matches[].title`)が混ざるので、payload 全体を `<untrusted_input>` で囲み、system instruction でも data 扱いを念押し。

### degraded 時は route で完全短絡
- レビュー指摘「degraded のとき investigate を呼ばず investigation=null で判定保留」を厳格に。
- `route.ts` で analyzeStructure が `degraded:true` → `{ degraded: true }` を即返す。investigate も judge も走らせない。
- これにより、`analyzeStructure` が NEUTRAL_LEVERS(プレースホルダ)を返したときに **絶対に判定スコアが出ない** ことが保証される。

### 後方互換
- `judge(levers)` の 1 引数呼び出しは型と挙動で互換維持。
- Task 3 / Task 4 の既存 24 件テスト(judge.test.ts と analyzeStructure.test.ts)は一切修正なしで pass。
- 既存 `judge.integration.test.ts` も `judge(BEC_LEVERS)`(investigation 渡さない)のため score===92 の assert がそのまま通過。

## どう

### 実装フロー
1. `weights.ts` に bonus 定数 + 純関数追加(`InvestigationReport` 型を import)
2. `judge.ts` をリライト: シグネチャ拡張、score 式に bonus 加算、payload に findings、result に bonus
3. `route.ts` を拡張: investigate を間に挟む、`authenticationResults` を payload から受け取る、レスポンスに `investigationBonus` と `investigation` を載せる
4. `judge.test.ts` に 16 件追加(各シグナル / cap / 後方互換 / 加点専用 / 内訳 / payload 検証)
5. `investigate.integration.test.ts` 新設(BEC を実 Gemini に投げて routing 確認)
6. typecheck + 単体 + 統合 で全 118 件 green

### 統合テスト実走の確認(本タスクで実機検証済み)
`$env:INTEGRATION="1"; npx vitest run` で 118 passed。
- `analyzeStructure` 統合 2 件 (Task 2): 維持
- `judge` 統合 1 件 (Task 3): score === 92 / 孤立化 / 非煽情 → 維持
- `investigate` 統合 1 件 (本 Chunk): BEC で `matchKnownScams` 必ず呼ばれ、条件起動ツール群のうち少なくとも 1 つが呼ばれ、`truncated === false`、全 finding が `status: ok | error` の graceful 範囲内であることを確認。

## 確認した完了条件
- [x] (a) 各シグナルで正しい加点(webRisk +15 / domainAge +10 / senderAuth +8 / knownScams +5/件 cap+15 / officialAlerts +8)
- [x] (b) `INVESTIGATION_BONUS_CAP = 25` が機能(raw 46 → 25 + `capped: true`)
- [x] (c) `judge(levers, null)` / `judge(levers, undefined)` / `judge(levers)` がすべて Task 3 と同一スコア
- [x] (d) `investigationBonus.items` の `source` と `points` が構造的に辿れる(UI / テスト)
- [x] 統合: BEC 実走で `matchKnownScams` + 条件起動 1 本以上が呼ばれ、`truncated:false`
- [x] `WEB_RISK_API_KEY` 未設定でも graceful 失敗(検証は status:error の許容で確認)
- [x] `npm run typecheck` エラーゼロ
- [x] `npm test` 114 passed、`INTEGRATION=1` で 118 passed

## やらなかったこと(Chunk 4 スコープ外)
- UI(Verdict カード内に bonus 内訳・調査結果を表示)— 次タスク
- 攻撃側エージェント / ループ / メトリクス UI(Task 7-8)
- ADK 導入(Task 8)
- weights / bonus 値の実コーパス校正(良性サンプル + scam サンプル収集後)
- `keyword` 抽出の自動化(現状は Gemini が description を読んで決める)

## 次タスク(UI 等)への申し送り
- `JudgeResponseBody.investigation: InvestigationReport` がレスポンスに含まれる:
  - `report.urlReputation` / `domainAge` / `senderAuth` / `knownScams` / `officialAlerts` のうち、Gemini が呼んだものだけ present(他は undefined)
  - `truncated:true` のとき、UI は「調査が時間切れで一部のみ完了」のような注記を出す候補
- `investigationBonus.items` を順に並べると「危険度に何が加算されたか」が表示できる:
  - 例: `webRisk: +15` / `senderAuth: +8` を箇条書きに
  - `capped:true` のときは「上限到達」マーク
- 既存 InboxApp のメッセージ送信に `authenticationResults` を追加(`sampleMessages.ts` で既に各 msg に乗せてある)→ API に渡せば認証情報も検査される
- Web Risk API key が未設定の環境では `urlReputation.errorMessage === "missing_api_key"` で見えるので、UI で警告アイコンを出すと運用上わかりやすい

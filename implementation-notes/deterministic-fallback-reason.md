# フォールバック説明の決定論化（レビュー指摘B: AI停止時も説明可能に）

## 課題

`judge.ts` の `FALLBACK_REASON` は汎用文1本（「解析結果から危険度を判定しました。文面を落ち着いてご確認ください。」）で、Gemini の説明生成が落ちると**危険判定（赤カード）なのに「何が危険か」が一切表示されなかった**。検出済みレバーと調査結果は手元にあるので、そこから決定論的に説明を組み立てられる — 説明生成に AI を使いながら AI 停止時にも説明可能にする。

## 設計

### `src/lib/fallbackReason.ts` — `buildFallbackReason(levers, score, investigation?)`

- **配置**: weights.ts の前例（決定論テーブルは lib）。judge.ts は LLM オーケストレーション専任のまま、gemini モックなしで単体テスト可能
- **band**: `score >= DANGER_SCORE_THRESHOLD`、**active 判定**: `strengthOf[key] > 0` — どちらも既存 export の内部計算で `pickActivePayload` と同一正本。**捏造禁止**（inactive レバーには言及しない）を決定論側でも保証
- **フレーズ表**: enum→日本語を `Record<Union, string>` / `Record<Exclude<Union,"none">, string>` で定義 — 語彙変更はコンパイルエラーで検出。incentive は **hook 粒度**（type は levers.ts が「コイントス的 artifact」と分類済み）。broadcast はフレーズなし（ユーザーが行動に移せる疑念でないため明示 skip）
- **句の選択**: `strength × LEVER_WEIGHTS` 降順（スコアリングと同じ重み正本）、同点は `LEVER_KEYS` 順の安定ソート。danger 3句 / safe 2句
- **isolation の扱い**: 通常プールから除外 — UI が `isolationNote` を独立した赤枠で出すため重複させない。例外は **floor 駆動でプールが空の danger**（isolation 単独 intensity 2-3 → ISOLATION_FLOORS 55/75）のみ。さもないと赤カードが何も説明できない
- **調査句**: 最大1つ、優先順位は bonus 点数順（webRisk 15 > domainAge 10 > senderAuth 8 > knownScams 5 > officialAlerts 8）、**発火条件は `computeInvestigationBonus` と同一** — 加点されなかったシグナルを理由に挙げない
- **道B / injection 衛生**: 補間は数値のみ（ageDays・一致件数）。ドメイン文字列・公的アラートのタイトル（外部テキスト）は絶対に埋め込まない
- **トーン**: LLM 版 §7 規則を踏襲 — danger は「なぜ危ないか」＋提案形の締め、safe は断定回避（「危険と言い切れるほどの…」「絶対に安全とは言い切れない」）

### judge.ts の変更（1行＋import）

try 前の初期値を `let reason = buildFallbackReason(levers, score, investigation) || FALLBACK_REASON;` に変更。`FALLBACK_REASON` は最終ガードとして残置。**Gemini 成功時の挙動はゼロ変更**（成功時は上書きされる）。`judgeSample.ts` は reason を読まないため影響なし。

### 検算済みの具体例（BEC フィクスチャ、score 92）

strength×weight: callToAction 9・personalization 9・urgency 6・authority 4・incentive 4 → 「送金を求めている」「あなた個人に関する情報が文面に使われている」「期限を区切って急がせている」の3句。authority（取引先を名乗っている）は4位で上限3から漏れる — 設計エージェント案のテスト期待はここが誤りだったため検算して修正した。

## テスト（TDD、赤→緑確認済み）

1. `lib/__tests__/fallbackReason.test.ts`（16件）: danger の句選択と上限3の固定／isolation 除外＋floor 駆動例外＋safe 低 intensity はゼロシグナル文／捏造禁止／safe の断定回避（「詐欺です」「安全です」なし）／調査句の最大1・優先順位・発火条件一致・タイトル非補間・件数補間／決定論（同入力同出力・全 band 非空）
2. `judge.test.ts` 更新2件: generateJson 拒否＋BEC で「送金を求めている」を含む（静的文字列一致は廃止）／調査レポート付き拒否で調査句を含み外部タイトルを含まない

## 検証ログ

- `npm test`: **449 passed** / 6 skipped（前回 432 → +17）
- `npm run typecheck`: エラーなし
- `npm run lint`: 0 errors / 7 warnings（すべて既存）

## 残作業（未実施）

- デモでの目視: Gemini を意図的に落とした状態（もしくは catch 経路の強制）で赤カードの決定論文面を確認する機会があれば尚良（ロジックはテストで固定済み）

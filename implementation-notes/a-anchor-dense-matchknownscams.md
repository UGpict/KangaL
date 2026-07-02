# A-anchor: matchKnownScams を密コサイン近傍へ格上げ

## 動機
レイテンシ議論から派生。`matchKnownScams` は「active な main-enum が 3/6 以上一致」の
離散照合で、僅差の near-miss（2.5/6 相当）を取りこぼす。攻撃ループが育てる
`attackPatterns` コーパスを"ビッグデータ"として活かすには、離散一致でなく**連続的な
近さ**で拾いたい。これが A-anchor（レバー空間・埋め込み不要・道B安全・新インフラ無し）。

なお **A-anchor はレイテンシを下げない**（`matchKnownScams` は analyzeStructure の下流で
走る）。効果は**検知精度**。リクエスト時レイテンシは別ライン（A-bypass = 本文埋め込み
→k-NN で LLM 抽出をバイパス）で、その可否は `scripts/probeKnnRecall.ts` の分離差で判定。

## 設計（決定事項）
6レバーを**強度スケール付き one-hot ブロック**に符号化し、`sqrt(LEVER_WEIGHTS)` 重み付き
コサインで類似度を出す（`src/lib/leverVector.ts`）。

- active enum 値のスロットに `strength/3 ∈ [0,1]`（`weights.strengthOf` を再利用＝judge の
  computeScore と**同一の強度モデル**）を置き、ブロック全体を `sqrt(LEVER_WEIGHTS[key])`
  でスケール。全特徴 ≥ 0 ⇒ コサインは**構造的に [0,1]**（clamp 不要）、自己=1。
- **不在 → ゼロブロック**（urgency/isolation "none"、authority "none"、personalization
  "broadcast"）。`classifyMatchedLever` の「不在は証拠でない」を連続で忠実再現。
- **incentive = 単一強度軸（決定B）**。reward/fear を同一軸に載せ、型フリップを
  構造的に不可視化（旧 5/6 除外より強い「コインフリップは決して加点しない」）。
- **personalization = signals を level 強度へ畳む（決定）**。`strengthOf` 準拠、二重計上回避。
- 重み駆動：isolation(w5) の一致が urgency(w2) より重い＝holdout 非依存で正当化可能。
- **構造的非水増し**：cosine ≤ 1 が単一 doc の寄与を抑え、下流 bonus は件数 cap
  （weights.ts）。既知例に対し recall を人工的に膨らませられない。

## 変更ファイル（実装コミット）
- `src/lib/leverVector.ts`（新規）— `encodeLevers` / `leverSimilarity` / スロット定数。
- `src/lib/__tests__/leverVector.test.ts`（新規, 6/6）— 自己=1・コインフリップ不可視・
  不在=0（強度非依存）・重み優位・強度単調・ゼロ保護。
- `src/tools/matchKnownScams.ts` — 離散 `similarity()` 削除→`leverSimilarity`。ループ/
  sort/cap/エラー処理は不変。
- `src/tools/__tests__/matchKnownScams.test.ts`（書換, 7/7）— exact=1.0・コインフリップ
  不変=1.0・near-miss回収・dissimilar除外・空/throw/sort/cap維持。
- `src/lib/weights.ts` — `strengthOf` を judge.ts から**純移動**（単一真実源）。
- `src/agents/judge.ts` — `strengthOf` を weights から import（判定不変・41/41）。

全 379 テスト緑 / typecheck・lint クリーン。

## 後続にステージ（実データ INTEGRATION 実行が要る＝推測で数字を作らない）
1. **τ 確定**：`KNOWN_SCAM_HIT_THRESHOLD = 0.5` は dense スケールの**暫定値**。
   `scripts/calibrateKnownScamThreshold.ts`（warm 済みコーパスで実行）の事前登録規則
   ——effective FPR 非回帰かつ easy 不変の下で recall 最大、同点は厳しい τ——で確定。
   effective 帯が空なら τ は確定しない（recall 曲線のみ）。
2. **`generalizationCheck.ts` の lockstep 移行**：現状まだ旧 discrete 3/6 を鏡写し
   （matchKnownScams のコメントに debt 明記）。dense では不在/コインフリップが構造的に
   0 ⇒ robust/coinflip の区別が消え **2-tier に簡約**。golden 再導出は確定 τ ＋実
   `measure-generalization` 実行に載せ、τ 確定と同じコミットで実施。

## 検証ゲート（τ 確定時）
`compareHoldout(before=discrete, after=dense@τ)` で recall の Wilson CI 改善かつ
effective 帯 FPR-CI 非回帰。満たす τ が無ければ「dense は勝てなかった」と正直に報告し
閾値据置。閾値を下げて無理に通さない。

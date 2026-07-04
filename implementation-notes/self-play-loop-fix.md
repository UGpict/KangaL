# self-play が no-op だった件の診断と修正（seed を evasion 寄りに）

## 発端
τ 較正のために corpus を warm しようとしたら、warmCorpus が 13/13 で
「rounds=1 / finalDetected=true」＝**すり抜けゼロ・コーパス 0 のまま**。self-play が
一度も回っていなかった。

## 診断（probeSeedDetection・実測）
generateAttackPattern の seed を 8 個生成し levers＋computeScore を観測:
- **8/8 が即検知**（score 78–94・全部 floor より高い＝線形合算そのものが閾値70超え）。
- **floor 由来 0/8**（当初仮説「isolation floor が犯人」は外れ）。
- 中身は全レバー振り切りの最大値スキャム（urgency i3・権威 maxed・fear i3・資格情報/送金・
  個人化・isolation i2-3）。

## 根本原因
コードを読むと設計意図が判明:
- **`evolve` は escalator**（全ミューテータが escalate 系）で、`detected:true` では明示的に
  throw（「すり抜けた型だけ進化させてよい」）。
- `fallbackSeed` は意図的に低強度（コメント「ループを回すのに十分・強い攻撃ではない」）。
- ＝**設計は「gen-1 が控えめにすり抜け → evolve が毎世代強化 → いずれ検知、その過程の
  slip-through を永続化」**。gen-1 は低強度で始まる前提。

ところが LLM 生成の generateAttackPattern が、この低強度設計を無視して毎回マックスを
吐いていた（プロンプト「検知器の死角を突く」を「最強の詐欺」と解釈）。→ gen-1 で即検知
→ loop break → evolve 不発 → コーパス永続化ゼロ → **A-anchor(known-scam) も永久に inert**。

（当初の推奨 (ii)「検知されたら evade 方向に evolve」は evolve の設計＝escalator と正面衝突
する誤りだった。正しい修正は (i) seed 側。訂正済み。）

## 修正
`src/agents/attacker.ts` の buildSystemInstruction を **evasion 寄り**に:
「自動検知器を *すり抜ける* 控えめな型／全レバーを盛らない／isolation・urgency を強く
立てない／境界線上の型」。道B・攻防分離は不変。attacker.test 25/25 緑。

## 検証（実測）
- probeSeedDetection 再走: **8/8 すり抜け**（score 27–43・isolation 全 none）。
- warmCorpus 再走: 系統ごとに slip→escalate→一部検知、**corpus 0→14 docs**。self-play が
  実際に回るようになった。

## 下流（τ 較正が初めて可能に）
corpus 非空＋effective-benign 3通で calibrateKnownScamThreshold が回り、事前登録規則が
**τ=0.60** を推奨（recall 1/6→2/6・FPR[effective]/[easy] とも 0 で非回帰）。ただし n=6 で
CI は広く重なる＝**方向性のみ・有意ではない**。recall 増は dependsOnKnownScam=1（1件が
corpus 由来）。

## 次（別の focused ステップ）
τ=0.60 の確定は `matchKnownScams.KNOWN_SCAM_HIT_THRESHOLD` 変更＋`generalizationCheck`
の dense lockstep 移行（golden を dense@0.60 で再導出・2-tier 簡約）が **同一変更で必要**
（定数を 0.60 にすると generalizationCheck の matched/6≥τ が 4/6 に化けて golden が壊れる）。
careful な結合作業なので独立したパスで行う。

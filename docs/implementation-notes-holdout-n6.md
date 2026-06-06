# Implementation Note — 柱2 実物ホールドアウト n=6 一次観測（道A の動機定点）

作成: 2026-06-06 / 対象: PLAN-v2 V4・T5（外部ホールドアウト評価）/ 正本: `docs/STATUS.md` + `docs/PLAN-v2.md`

このノートは **再現可能な観測装置（`scripts/evalRealHoldout.ts` + `src/data/realScamHoldout.ts`）が返した最初の生データ**を履歴に固定するためのもの。後で床（threshold）や投資ボーナスをいじったとき、「いじる前の実物 recall はこうだった」と定点で指せるようにする。決定は記憶でなく記録。

## 1. ホールドアウト構成（n=6）

`src/data/realScamHoldout.ts` の REAL_SCAM_HOLDOUT（全 scam / benign=0）。

- 出所内訳: 実受信（自分の inbox）:5 / フィッシング対策協議会:1
- アーキタイプ: 政府×2（年金/PayPay・e-Tax/PayPay）・金融×2（楽天カード/PayPay・三井住友Vポイント）・platform×2（Apple ID・Amazon Prime）
- うち `smbc-vpoint-expiry-2026-06` のみ incentive=reward 系（失効煽り）。urgency/penalty が弱くレバー素点が低く出やすい＝床またぎ候補。
- 規律: 捏造禁止（本文 verbatim）／照合器ブラインド（検知器が捕る/捕らないで逆算選定しない）／出所分離（recon が読む officialAlerts.json は架空、実受信/協議会と素材源が交わらない＝unseen 不変が崩れない）。

## 2. n=6 生数字（threshold=70 / benignDifficulty=easy / live investigate）

```
holdout(scam)=6 / benign=0
出所内訳: 実受信:5 / フィッシング対策協議会:1
```

| | recall(生) | detected | missed-floored | missed-perception | degraded | leverAlone | dependsOnKnownScam | dependsOnInvestigation |
|---|---|---|---|---|---|---|---|---|
| BEFORE/cold | 2/6 | 2 | 4 | 0 | 0 | 2 | 0 | 0 |
| AFTER/warm  | 1/6 | 1 | 5 | 0 | 0 | 1 | 0 | 0 |

- WARM: self-play 3 系統 × maxRounds=5 → 全系統 rounds=1 / finalDetected=true。
- DELTA: detected 2 → 1（Δ=−1, 生カウント）。
- FPR(生): 0/0 ※easy-only＝真の FPR の下界。benign を holdout に入れていない以上、FPR について何も主張しない。

小標本（n<30）につき率に丸めない。X/n 表記のみ。

## 3. 読み（誤読防止）— Δ は信号でない

- **コーパスは BEFORE↔AFTER で変わっていない。** warm 全系統 finalDetected=true → slip-through ゼロ → `persistPattern` 発火せず → BEFORE と AFTER は同一コーパスを読む。固定コーパス下で動く変数は `analyzeStructure` のレバー素点ゆらぎ（床70境界）だけ。Δ=−1 は **境界ジッタ**であって warm 由来の劣化でも汎化でもない。
- **汎化の主張はここでは立てられない。** 攻撃 self-play が検知器の既捕パターンしか産まず学習材料（slip-through）が生まれない＝**ループ動態の発見**であり計器の失敗ではない。
- **漏洩なし・暗記なし。** 両パス `dependsOnKnownScam=0`＝AFTER recall は known-scam ボーナス由来ゼロ。不変条件A の境界テストが実地でも効いている。
- **主報告の固定規約**: 主軸は `dependsOnKnownScam=false` サブセットの per-sample 検出率。今回 false サブセット＝全6（known-scam 寄与ゼロ）なので overall と一致するが、規約として固定する。

## 4. 陽性所見（埋もれさせない）: missed-perception=0

`analyzeStructure` は実物フィッシング6通すべてを「攻撃」と知覚できている（missed-perception=0 / degraded=0）。弱い recall（1〜2/6）に埋もれるが、これは **「知覚は効いている、ゲート（床）だけが厳しい」** を意味する陽性結果。

- もし missed-perception が高ければ「そもそも実物を攻撃と見抜けない＝より深い設計問題」で、床をいじっても無駄だった。
- 知覚が通っているからこそ **床が単一のボトルネック**だと言い切れる。全ミスが missed-floored（知覚済みだが <70）であることがそれを裏づける。

## 5. これが構成する動機（道A）と次の一手

- **道A（床見直し）が実データで動機づいた**: 実物 5/6（AFTER）が「知覚済みだが床落ち」。十分な n を待っていた一次証拠がこれ。
- **次: K-run（`--freeze-investigation`）で per-sample 検出率分布を取り、2つの「<70」を割る**:
  - (a) 真に床下＝何回回しても70に届かない構造的取りこぼし。複数 run で 0/K か K/K に張り付く。→ 床を下げる／投資ボーナス寄与を上げる対象。
  - (b) 境界ジッタ＝70 上下を確率的に跨ぐ。複数 run で検出率 0.5 付近。→ 床を下げても跨ぐ位置が下にずれるだけで recall は安定しない＝分散の問題。決定論化／スコア安定化で手当て。
- (a)/(b) の頭数割りが、道A を「床を下げる」にするか「分散を締める」にするかを決める。**K-run 無しで床を下げると (b) のサンプルで偽の改善を見て過学習する。**

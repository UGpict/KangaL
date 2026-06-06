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

## 6. K-run 実測（K=10・investigation 各サンプル1ドロー凍結・threshold=70）

事前固定 K=10（結果を見て延長しない＝分布の事後いじり禁止）。`scripts/evalRealHoldout.ts --freeze-investigation`、`KRUN=10`。investigation を各サンプル live で1回だけ引いて固定し、judge を10回（analyzeStructure＝レバー知覚だけが run 間で動く）。全件 knownScamBonus=0＝ホールドアウト全体が dependsOnKnownScam=false サブセット＝per-sample 検出率がそのまま主軸数値。

| サンプル | detRate | 分類 | scores | spread | 中心 |
|---|---|---|---|---|---|
| antiphishing-nenkin-paypay | 5/10 | 境界ジッタ(b) | 78,71,65,90,90,71,65,67,65,65 | 25 | ~70 |
| rakuten-card-saisai | 5/10 | 境界ジッタ(b) | 78,75,75,61,61,80,61,80,69,43 | 37 | ~68 |
| etax-shotokuzei | 0/10 | 床下(a) | 65,67,61,61,61,53,65,61,65,65 | 14 | ~62 |
| smbc-vpoint-expiry | 0/10 | 床下(a) | 61×8,53,61 | 8 | 61 |
| amazon-prime | 0/10 | 床下(a) | 43,45,35,53,45,49,49,69,63,55 | 34 | ~50 |
| apple-id-payment-fail | 0/10 | 床下(a) | 39,35,35,41,41,55,45,41,61,51 | 26 | ~44 |

### live Δ を K-run が説明しきる
live の2検出（BEFORE）＝(b)の年金・楽天そのもの。両者 ~0.5 で跨ぐので BEFORE detected=2（両方表）→ AFTER detected=1（片方）は coin-flip で一致。(a)4件は K-run でも 0/10＝live でも常時床下。**Δ=−1 が境界ジッタである証明が独立に取れた**（investigation 凍結＝lever-score 分散だけ残した条件でも同じ2件だけが跨ぐ）。

### 道Aの的（3層に割れる）
1. **境界ジッタ(b)＝年金・楽天**: 中心 ~68-70。閾値 60 で年金 10/10・楽天 9/10 と安定検出側へ寄る。ただし分散は残る（楽天 spread=37）＝床下げ＋決定論化/安定化の併用が筋。
2. **床際(a)＝etax・smbc-vpoint**: 中心 61-62・spread 小。構造的に70直下で安定＝純粋な「床の高さ」問題。閾値 60 で etax 9/10・smbc 10/10。**床を下げれば素直に回収できる本体。**
3. **深い(a)＝amazon・apple**: 中心 44-50・spread 大。閾値 60 でも amazon 2/10・apple 1/10＝**床いじりで救えない真の検知ギャップ**。両者とも怪しい URL 保有（apple=ettiqyn.com / amazon=profileslate.com）＝investigation（URL レピュテーション）寄与を上げるのが床と別系統の手当て候補。amazon は同一固定文で素点 35↔69 と暴れる＝知覚不安定も併発。

→ **道A=床 70→~60 は (b)2件＋床際(a)2件の計4件を回収する正当手。** だが amazon・apple は床問題でなく知覚/レバー/investigation 側の別課題。

### 但し書き（2点）
- 凍結ドローのバイアス: 検出率の絶対値は investigation 1ドローに依存。amazon/apple が「真に深い」か「凍結ドローで URL bonus を引けなかった」かはこの run では分離不能（investigation 分散込みの非凍結多重 run が要る）。(a)/(b) の相対判定は lever-score 分散が決めるので有効。
- K-run 出力に otherInvestigationBonus を載せていない（knownScamBonus のみ）。amazon/apple の低スコアに investigation bonus がどれだけ効いたか分解できない。次の K-run でこの列を足す（今回は事後再ロール回避のため追加 run はしない）。

## 7. 道A 着地: 膝は「点」でなくバンド（(ii) ルート確定・§6 の「床~60＝確定的な膝」を上書き）

§5/§6 は「床 70→~60 で4件回収＝膝60」と読んだ。**この読みを本節が上書きする**: 膝は決定論的な点ではなく、~0.5 検出率サンプルを含む **コインフリップ帯**。recall 4/6 は小標本＋分散の上に乗った揺れる多数決であって「確定した4件」ではない。

### 7.1 決定論化が成立しないことの確認（probe 3本・観測専用・未コミット）

`scripts/probeLeverVariance.ts` / `probeMajorityVote.ts` / `probeRateConvergence.ts`（いずれも未コミット＝観測専用）と `analyzeStructure` への追加専用 temperature フック（既定不変＝本番は1ビットも変わらない）で、lever-score 分散の決定論化可否を amazon（deep(a)・分散源の一石二鳥）で実測した。連鎖:

1. **分散の根**: temperature=0.2 ＋ structured-decode 残留の2源（temp=0.2 amazon leverScore spread=32, 中央値~51）。
2. **temp=0**: isolation 幻視 flip は止まるが残留は消えない（spread 32→20、中央値 51→47＝方向は正・改悪なし）。personalization/incentive は temp 無反応。
3. **残留は既約**: K=20/30 の生率＋Wilson95%CI で、incentive(i2) が **ちょうど 50%**（CI が 0.5 をまたぐ）、personalization は n を増やすほど点推定が 0.5 へ寄る（(ii)）。対照の isolation(none) は CI が 0.5 を外して解決＝「(ii) は計器の癖でなく真の ~0.5」を陽性対照で締めた。
4. **多数決は決定論化の道具にならない**: ≥2レバーが既約に ~0.5＝どんな K でも mode が確率的に裏返る。多数決抽出を本体に入れても膝は固定されない。
5. **結論**: 膝 recall 4/6 は ~0.5 検出率サンプルを含む。床際 ±4–6pt のコインフリップが床 60 を跨ぐ。amazon は中心が深く無害（床に絡まない）、膝の中身が致命。

→ **決定論化（道B・isolation プロンプト厳格化）は採らない**。incentive が完全 50/50＝既約、かつ最も侵襲的（検知器本体を触る）で、潰しても別境界へ逃げるだけ。膝は X/n＋CI バンドで正直に語る。

### 7.2 道A 着地レポート（凍結 K-run 行列＋Wilson95%CI・LLM コール ゼロ）

`scripts/reportRoadALanding.ts`（観測専用・未コミット）で、**別の凍結 K-run 行列**（投資1ドロー凍結・K=10・§6 とは別 seed）に計器 `holdoutEval` の Wilson/バンド関数を当てた。**床値・閾値・多数決規約・検出規約は不変**＝事前登録 X/n の区間表示であり、結果を見てから metric を差し替える事後変更ではない（fishing でない）。

出力1（床トレードオフ・バンド）:

| 床 | recall X/6 [CI] | FPR[easy] X/3 [CI] | FPR[effective] |
|---|---|---|---|
| 70 | 1/6 17%[3-56%] | 0/3 0%[0-56%] | n/a(未投入) |
| 65 | 3/6 50%[19-81%] | 0/3 0%[0-56%] | n/a |
| 62 | 3/6 50%[19-81%] | 0/3 0%[0-56%] | n/a |
| 60 | 4/6 67%[30-90%] | 0/3 0%[0-56%] | n/a |
| 58 | 4/6 67%[30-90%] | **1/3 33%[6-79%]** | n/a |
| 55 | 4/6 67%[30-90%] | 1/3 33%[6-79%] | n/a |

- **隣接床の recall CI は全ペアで重なる**（65↔62↔60↔58）＝n=6 では床差に統計的意味がない。「膝=60」を点として主張できない直接の証拠。
- FPR[easy] は床 58 で初めて 1/3。その FP（etax-nofu-kanryo）自体がコインフリップ（4/10・CI が 0.5 をまたぐ）＝床 58 の FP も確定でなく揺れ。

出力2（per-sample 検出率＠床60・膝の中身）:

| サンプル | detRate@60 [CI] | @70 | 床際? |
|---|---|---|---|
| etax-shotokuzei(scam) | 9/10 90%[60-98%] | 0/10 | 安定検出 |
| rakuten | 9/10 90%[60-98%] | 4/10 | 安定検出 |
| nenkin | 8/10 80%[49-94%] | 5/10 | ★コインフリップ(CI lo=49%) |
| smbc | 6/10 60%[31-83%] | 0/10 | ★コインフリップ |
| amazon | 3/10 30%[11-60%] | 3/10 | （膝外）★CI が0.5をまたぐ |
| apple | 1/10 10%[2-40%] | 0/10 | 深い(a)・安定低 |

→ 床60 の膝4 = {etax-scam, rakuten, nenkin, smbc}。うち **2件（nenkin, smbc）はコインフリップ**、2件（etax-scam, rakuten）は床60 で安定検出。

### 7.3 §6 K-run との不一致（正直に記録・(ii) を強める）

§6 と §7.2 は**別の凍結 K-run**で、絶対検出率がずれる:
- recall@70: §6=2/6（年金+楽天）／§7.2=1/6（年金のみ・楽天は 4/10 で多数決割れ）。
- コインフリップの**同定が run 間で不安定**: §6 は年金+楽天が(b)、§7.2 では年金+smbc。楽天は §7.2 で床60 安定側へ。

原因は §6 但し書きの「凍結ドローのバイアス」＝investigation 1ドローが列全体を上下させる。**これは (ii) を弱めるのでなく強める**: per-draw の lever-score が ~0.5 なだけでなく、凍結 seed 間にもう一層の run 間分散が乗る＝膝は単一 K-run が見せるよりさらに点でない。**両 run が一致する構造的主張**だけが頑健: (a) 膝 recall は ~4/6 で CI が非常に広い、(b) 膝は必ずコインフリップ samples を含む、(c) deep(a) apple は床を下げても ~0 で安定、(d) FP は床を下げると現れるがそれ自体コインフリップ。

### 7.4 道A の現在の結論（人間の床決定に返す）

- 制度系（e-Tax/年金/楽天/smbc）の recall は床 ~60 バンドまで上げられるが、**点でなく 4/6 [30-90%] のバンド**。隣接床 CI が重なる以上、床 60 を「最適点」とコードで選ばない。
- **deep(a)=apple は床問題でない**（床60 でも ~0）。URL レピュテーション investigation 側の別系統手当ての領分（§6 道Aの的 layer3 のまま）。
- **FPR[effective]（商用ストレッサー）は未投入＝測定不能**。床下げの真の FP 危険はまだ言えない。床決定は effective 投入後に保留。
- **床はコードで選ばない**。バンドを提示し、床決定（CI バンドと effective FP を睨んだ判断）は人間に返す。

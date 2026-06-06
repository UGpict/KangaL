# implementation-notes: T2 診断（締め）— 素の実走で recall は回復するか（実エージェント・複数 seed）

実施: 2026-06-05 / 対象: PLAN-v2 T2 の「診断」フェーズ（観測のみ・閉ループは未実装）
正本: `docs/STATUS.md`（現実）/ `docs/PLAN-v2.md`（計画）。本書は T2 の DoD「結果を保存」に対応。
本版は前版（単一弱種トラジェクトリ）を、停止条件と seed の扱いを締めた再走で置換したもの。

## 0. 目的

V1（PLAN-v2 §1）の予言 ―「防御側が静的＝回復機構が無いので、素の実走では recall が回復しない」― を実エージェントで実測し、最小閉ループが必要であることの根拠を残す。**これは失敗の記録ではない。** 想定どおり「回復しない」なら V1 の裏付け。想定に反する挙動が出たら、その機構を特定する（次の設計が変わりうる）。

## 1. 方法（観測の汚染を避けるための線引き — 厳守）

- ハーネス: `scripts/diagnose-loop-recall.ts`（観測専用）。**`loop.ts` / `firestore.ts` は一切変更していない**。
- **注入してよいのは「初期 seed」と「停止ポリシー」だけ。** prompt・閾値・evolve ロジックは触らない。本ハーネスが差し替えるのは driver の for-loop（停止条件と seed の供給）のみで、**`investigate` → `judge` → `evolve` の本体は loop.ts が呼ぶのと同一の step を一字一句変えずに同一に呼ぶ**（src からの import そのまま）。
  - ⇒ これにより T2-③ で「観測したのは本番（loop.ts）と同一手順」と言い切れる。
- **停止ポリシー = no-break**: 固定 max-rounds（=12）で回し切り、検出後も止めない。これは「停止条件の注入」であって evolve ロジックの改変ではない。`evolve` は `feedback.detected===true` で throw する契約なので、エスカレートを継続させるため毎ラウンド `{detected:false}` を渡す（evolve 本体・閾値・prompt は不変。`missedBy` は本物の `report` 由来をそのまま）。
- 検出閾値 `threshold=70`（既定）。判定は `score >= threshold`。`DEMO_MODE=true`。実 Gemini（Vertex, `gemini-2.5-flash`, project `ai-bridging`, ADC）。`matchKnownScams` は実 Firestore（`attackPatterns` 空＝matches 0＝bonus 0、V5 どおりの初期状態）。
- **1本の trajectory は1サンプル**。形を一般化しないため、**固定 literal seed を複数本**回して分布を見る。seed は実 BEC に近い subtle なもの（赤信号が薄い）を用いた。Gemini に「攻撃を作れ」と言うと教科書的なカリカチュア（赤信号だらけ→即検出）を出すため、洗練された攻撃の動態はこの subtle seed でしか観測できない。

### seed（3本・固定 literal）

| seed | 性格 | 初期レバー要約 |
|---|---|---|
| bec-exec-wire | CEO詐欺風 | exec なりすまし/formal_tone・送金/mid・targeted/jargon・secrecy/1 |
| vendor-invoice | 取引先請求書風 | business_partner/参照番号+formal・送金/mid・targeted/thread・iso none |
| platform-credential-soft | 穏やかな資格情報フィッシング | platform/トリック無・input_credentials/high・segmented・iso none |

## 2. 結果

### 参考: モードA — 実 runLoop（前版で実測済み・本版では非実行）
実 `runLoop` は gen1（Gemini 生成）が初手で score 84（≥70）→ ラウンド1で検出→break。**実 Gemini は強い攻撃を生成するため初手で検出され、evolve が一度も走らない。** これが subtle seed を別に用意した理由。

### 締め: 複数 seed・no-break トラジェクトリ（各 12 ラウンド固定）

totalScore = leverScore（lever のみの決定論スコア）+ investigation bonus。

| seed | totalScore 系列 | leverScore 単調非減少 | totalScore dip |
|---|---|---|---|
| bec-exec-wire | `55,55,55,55,65,83,83,83,86,92,96,100` | true | **無** |
| vendor-invoice | `49,41,41,49,51,69,75,83,86,90,96,100` | true | **有（49→41）** |
| platform-credential-soft | `16,22,27,27,27,27,37,55,75,75,75,75` | true | **無** |

- 3 seed すべて **初手で未検出**（subtle BEC は score 49〜55、平易フィッシングは 16）。**＝赤信号に依存する現検知器は、洗練された BEC を初手で取り逃す。**
- **leverScore（lever のみ）は全 seed で単調非減少。** evolve の固定ラダーは detectability を上げるか据え置くのみで、下げる手を持たない。
- recall（per-round, 単一 scam の二値）は各 seed で `0…0,1,1,…`＝検出に到達したら以降 1。**一度も「下がってから戻る」が起きない。**

### dip の正体（重要・脚色せず機構で確定）

- vendor-invoice round1→2 の `49→41` は **leverScore は 41 で不変**、変わったのは **investigation bonus（+8→+0）**。同 seed round3→4 でも `+0→+8` と戻っている。
- ⇒ **この dip は調査 bonus の非決定的ばらつき**であって、防御が学習したことによる回復ではない。bonus は調査ツール（Web Risk/RDAP 等）の結果と Gemini のツール選択に依存し、ラウンド間で `+0〜+8` 程度揺れる。
- ⇒ **「score の dip」と「recall の回復（防御が育つ）」は別物。** 今回出た dip は前者であり、後者は 0 件。

## 3. 機構的裏付け（コードで確認済み）

1. **`investigate()` は `missedBy` をセットしない**（戻り値は `findings/truncated/truncatedReason/bonus` のみ）。全 seed・全ラウンドで `missedBy=—`。→ `loop.ts` の `firstMissed` は常に undefined → `evolve` の directed-mutation 分岐は実走では死にコード。
2. **evolve は固定ラダーのみを通り、各ステップは leverScore を上げるか据え置く**（下げる手は無い）。`ISOLATION_FLOORS` により isolation intensity=3 で floor 75 ≥ 70 → 必ず検出に到達。leverScore 系列がこれを実証。
3. **防御側は静的**: Firestore への writer は `upsertBenignSample`（benign のみ）だけ。`loop.ts` は firestore を import せず、すり抜けたパターンを `attackPatterns` に書き戻さない。→ ラウンド間で `matchKnownScams` のコーパスは増えず、検知器は改善しない（known-scam bonus 恒常 0）。
4. **bonus の非決定性**: totalScore は決定論ではない。上記 dip のとおり investigation bonus がラウンド間で揺れる。→ **閉ループ効果の検証を「bonus が増えたか」で測るとノイズに埋もれる。`matchKnownScams.matches` が 0→非空になったか、で測る**（V5 の判定方針と整合）。

## 4. 判定（V1 の確定 + 強化）

- **V1（回復機構が無い）: 確定。** 実走で recall は回復しなかった。閉ループが無いため検知器はラウンド間で育たない。
- **V1 の強化**: leverScore は単調非減少で、回避（低検知への探索）をしない。directed-mutation は死にコード。
- **想定の微修正（締めで判明）**: 「totalScore は単調非減少・dip 無し」は **誤り**。bonus ノイズで小さな dip は出うる（vendor-invoice）。ただし **その dip は防御学習による回復ではない**。scripted `DEMO_ROUNDS` の「検知率ダウン→回復」アークは、現行の実機構には回復側の基盤が無い（dip 側は bonus ノイズで偶発的に出るだけ）。

## 5. 次の設計への含意（PLAN-v2 T2 実装へ反映）

- 最小閉ループ（`upsertAttackPattern` + 書き戻し、PLAN-v2 V1/V2）を実装する。書き戻し対象＝detected=false の全件、照合条件＝既存 `matchKnownScams` 類似度（この設計は今回の dip 発見で変更不要）。
- **検証指標**: 閉ループが効いたことは **bonus 値ではなく `matchKnownScams.matches` の 0→非空** で確認する（bonus はもともと揺れるため）。
- in-loop recall（暗記込み）の回復はこの閉ループで出せるが、「検知器が育った」の主張には書き戻していない新規型（外部ホールドアウト）への汎化が要る＝ T2-③ / T5 で検証。② のゴールは「書き戻し配線が動く・matches が埋まり始める」まで。

## 6. 再現

```bash
GOOGLE_CLOUD_PROJECT=ai-bridging GOOGLE_CLOUD_LOCATION=us-central1 \
  DEMO_MODE=true DIAG_RUNS=0 DIAG_SEEDS=1 DIAG_MAXROUNDS=12 \
  npx tsx scripts/diagnose-loop-recall.ts
```

要 Vertex ADC。**§1〜§6 の診断時点では `loop.ts`/`firestore.ts` 不変**。leverScore はほぼ決定論なのでトラジェクトリの骨格は再現性が高い（totalScore は investigation bonus の非決定性で小さく揺れる）。

## 7. 閉ループ実装後の実環境確認（PLAN-v2 T2 / 2026-06-05）

§1〜§6 の診断を受けて、最小閉ループを実装した（**ここで `firestore.ts`/`loop.ts` を変更**）:
- `src/lib/firestore.ts`: `upsertAttackPattern(pattern)` を追加。`upsertBenignSample` と同作法で `attackPatterns` コレクションへ。道B 厳守＝レバー＋channel のスキーマのみ（完成詐欺文なし）。id は doc id。
- `src/agents/loop.ts`: `LoopAgents.persistPattern`（既定=`upsertAttackPattern`）を追加。すり抜け（detected=false）の各ラウンド（最終ラウンド含む）で書き戻す。検知ラウンドは書き戻さない。V3 維持＝書き戻しは defender 側 loop が行い、`attacker.ts` は firestore 非依存のまま。
- ユニットテスト: `firestore.test.ts`（upsert の書き込み形・id/parentId/detectionResult の扱い）、`loop.test.ts`（すり抜けのみ書き戻し・検知ラウンドは書き戻さない・最終ラウンドも書き戻す）。全緑。

実環境エンドツーエンド確認（`scripts/verify-closed-loop.ts`。loop.ts の実配線をそのまま使い、subtle seed のみ `generateAttackPattern` に注入。`persistPattern`/`investigate`/`judge`/`evolve` は既定＝実 Firestore/実 Gemini）:

| 段階 | attackPatterns 件数 | matchKnownScams |
|---|---|---|
| BEFORE | 0 | **0 matches** |
| RUN（subtle seed・3R 全すり抜け） | 3 件書き戻し | — |
| AFTER | 3 | **3 matches** |
| CLEANUP（検証 doc 削除） | 0 | 0 matches |

- **DoD: PASS。** 最小閉ループでコーパスが **0→非空** になり、`matchKnownScams` が次ラウンドで類似パターンを捕捉できる＝**V5/V1 が解け始める**ことを実環境で確認した。所要 32.3s。
- 検証データは削除しコーパスを空に戻した（以降の T3/T5 実測を汚さないため）。
- **留意（T2-③ へ）**: これは in-loop の「書き戻した型と同一/酷似の捕捉」＝**暗記**の成立確認まで。「検知器が育った（汎化）」の主張には、書き戻していない新規型（外部ホールドアウト）への recall 回復が要る＝ T5 で検証。② のゴール「書き戻し配線が動く・matches が埋まり始める」は達成。
- 再現: `GOOGLE_CLOUD_PROJECT=ai-bridging GOOGLE_CLOUD_LOCATION=us-central1 DEMO_MODE=true npx tsx scripts/verify-closed-loop.ts`
- **6/14 引き際チェックポイント（PLAN-v2 §3）の決定: 閉ループでGO。** §4 の判定（V1 確定＝静的防御では回復しない／最小閉ループを実装する）を、本節の実環境 DoD PASS（0→非空、`matchKnownScams` が翌ラウンドで捕捉）で裏付け。シードベース半自律（03-1 相当）には倒さず、`upsertAttackPattern` + 書き戻し配線の最小閉ループを正式採用と確定した。

## 8. T2-③: 暗記 vs 汎化 — 照合器ブラインドの lever ホールドアウト（2026-06-06）

ハーネス: `scripts/measure-generalization.ts`。in-loop 走は §1〜§7 と同条件（同一 step・no-break・persist ON のみ差分）。ホールドアウト評価は lever ベースの完全決定論（Gemini 不使用）＝ `total = computeScore(levers) + matchKnownScams 由来の known-scam bonus`。`threshold=70`、bonus は `+5/match`・上限 `+15`。

### 8.1 ホールドアウトの構築原則（照合器ブラインド・現実性のみ）

過去版は「active レバーを seed 署名に寄せて 3/6 を作る／非 flip 対照を逆算で置く／lever-score を rescue 帯に乗せる」という**逆算**を含んでいた。これは flip 結果を設計で事前確定させる汚染（寄せる＝正の逆算、離す＝鏡像の負の逆算）なので全廃。現行は:

- 照合器(`matchKnownScams`)の enum セットを見ない・寄せない・離さない。
- 各 holdout は「現実的な subtle BEC で、攻撃側 evolve が生成しない型」という現実性だけで作る。攻撃側への唯一の制約は「seed 系統に無い `(authority×cta)` を選ぶ」（＝未到達の担保。`evolve` は authority/cta/incentive.type/urgency.tactic を変えないので seed 系統の `(authority×cta)` は固定）。
- 残り4レバーは現実の手口からそのまま起こし、seed 署名と一致するかは成り行きに任せる。lever-score がどの帯に落ちるかも結果。
- ⇒ 各 holdout が flip するかは「走らせるまで不明」。

seed は §1 の3本（bec-exec-wire / vendor-invoice / platform-credential-soft）。育った corpus は14件（bec 3 + vendor 4 + platform 7、すり抜けラウンドのみ書き戻し）。

### 8.2 結果（BEFORE 空コーパス → AFTER 育成後）

holdout recall: **BEFORE 0/6 → AFTER 3/6 = 0.50**（設計ではなく成り行きで出た）。

| holdout (unseen authority×cta) | leverScore | matches | total | detected | tier |
|---|---|---|---|---|---|
| exec-portal-login (executive×input_credentials) | 61 | 4 | 76 | YES | **robust** |
| exec-app-install (executive×install_app) | 59 | 3 | 74 | YES | **robust** |
| exec-vishing-call (executive×call_number) | 63 | 3 | 78 | YES | **coinflip依存** |
| vendor-thread-link (business_partner×click_link) | 41 | 5 | 56 | no | — |
| vendor-portal-login (business_partner×input_credentials) | 51 | 5 | 66 | no | — |
| platform-settle-wire (platform×transfer_money) | 53 | 1 | 58 | no | — |

### 8.3 (a)/(b) 自己点検の厳格化 — 3段階分類

旧判定は「能動一致が1つでもあれば汎化」＝`matchedActive.length>0`。これは exec-vishing-call（能動一致 authority+personalization の**2つ** + coin-flip の incentive で 3/6 到達）を「汎化」と過大評価した。厳格化の基準を導入:

> **判定基準: 能動レバーのみで類似度閾値(3/6=0.5)に到達するか。** 照合から (b) アーティファクト（`incentive.type` の reward/fear coin-flip、`urgency`/`isolation`="none"・`personalization`="broadcast"・`authority`="none" の不在一致）を除いた「能動レバーのみの bonus」で `leverScore` が単独で `threshold` に届けば **robust 汎化**（coin-flip を抜いても flip が残る）。

- **robust（2件）**: exec-portal-login / exec-app-install。能動レバー authority(executive)+personalization(targeted)+isolation(secrecy) の**3つだけで 3/6** に到達し、能動 bonus だけで total≥70。incentive(fear=coin-flip)は上乗せで load-bearing ではない。→ 「役員＋ターゲット化＋内密」という BEC 構造を seed 系統から学び、未見の `(exec×input_credentials / exec×install_app)` に転移した本物の汎化。
- **coin-flip 依存（1件・汎化に数えない）**: exec-vishing-call。能動一致は authority+personalization の2つのみ（isolation=`direct_channel` は corpus に出現せず不一致、`evolve` は none→secrecy しか作らない）。3/6 到達に必要な3つ目は coin-flip の incentive(fear)。これを抜くと 2/6=0.33 で flip 消失。能動 bonus=+0、`leverScore 63 < 70`。
- **非 flip（3件）**: vendor 2件は urgency=none・isolation=none で lever-score が rescue 床(55)未満（+15 でも 70 未満）＝「自然な業務メールはレバー化すると弱い」正直な結果。platform-settle-wire は personalization=segmented が platform seed 系統の targeted とズレ 1 doc しか閾値超えせず +5 のみ。いずれも対照として置いたのではなく成り行き。

**3段階の集計: robust 汎化 2 / coin-flip 依存 1 / 非 flip 3。汎化として数えるのは robust の 2 件のみ。**

### 8.4 実装と検証（検知器は不変）

- 解釈ロジックは `src/lib/generalizationCheck.ts`（評価側）に分離。`matchKnownScams` の similarity と「total≥70 で flip」の検知本体には**一切触れていない**。足したのは flip した件の3段階分類だけ。
- ユニットテスト `src/lib/__tests__/generalizationCheck.test.ts`: 本走の生データ（14件 corpus + 6 holdout）を golden fixture にして、**robust 2 / coin-flip 依存 1 / 非 flip 3 を Gemini 不要で決定論的に再現**。特に「能動2 + coin-flip1 で 3/6」の exec-vishing-call が coin-flip 依存に分類されることを検証。全スイート 195 passed。

### 8.5 判定と T5 への含意

- 修正は機能した: flip/非 flip を設計で事前確定させず、各 holdout の運命は走らせるまで不明だった。AFTER 0.50 は設計の産物ではない。汎化として誠実に数えられるのは robust 2 件。
- ただし**捕捉できているのは executive 系統に構造が近い未見型だけ**で、vendor/platform の subtle 型は lever-score 床で取りこぼす。「現状の照合（6 enum main-value + isolation 床）では subtle BEC の一部を捕捉できない」正直な限界 → **T5（照合式の改善: 床の見直し / coin-flip レバーの重み抜き / similarity の細粒度化）**の入力。
- 設計§7 の区別: これは私が現実の手口をレバー化した **lever 水準の汎化プローブ**であって、フィッシング対策協議会/IPA 等の**実物サンプルを物理隔離した外部 holdout** ではない。「実際に人を守れる」証拠としては後者が別途必要（宿題として残る）。
- 再現（決定論部のみの検証）: `npx vitest run src/lib/__tests__/generalizationCheck.test.ts`。実走（コーパス育成込み）: `GOOGLE_CLOUD_PROJECT=ai-bridging GOOGLE_CLOUD_LOCATION=us-central1 DEMO_MODE=true npx tsx scripts/measure-generalization.ts`（in-loop の investigation bonus は非決定的なので書き戻し件数は揺れうる）。

## 9. T5 柱1(ii): 照合式の能動限定（coin-flip レバーの重み抜き）— 検知器を初めて変更（2026-06-06）

T2 を通して不変に保ってきた検知器本体（`matchKnownScams` の similarity）を、柱1で初めて変更した。変更前に「何をもって改善とみなすか」を過適合を避ける形で確定（設計合意）し、**ステップ2（予測の紙）をステップ3（検知器変更）の前に固定**してから実装した。

### 9.1 何を変えたか（除外方式・denominator 6 固定）

- `matchKnownScams.similarity` の **numerator を「main-value 一致かつ能動レバー」のみ**に限定。アーティファクト（`incentive.type` の reward/fear coin-flip、`urgency`/`isolation`="none"・`personalization`="broadcast"・`authority`="none" の不在一致）は一致しても **0 点**。**denominator は 6 固定**（能動可能レバー数に縮めない＝0.5 閾値の意味をパターン非依存に保つ）。
- 分類ロジック `classifyMatchedLever` / `mainValue` / `LEVER_KEYS` を中立モジュール `src/lib/levers.ts` に抽出。依存方向は **検知器→levers・評価側(generalizationCheck)→levers** のみ。検知器は評価側に依存しない（循環回避）。
- 検知器契約テスト1件を更新: exact match のスコアは **1.0 → 5/6**。byte 同一パターンでも incentive(coin-flip)を credit しないため。これは (ii) の正しい帰結であって退行ではない。

### 9.2 補強点（重要・(ii) の成功を「取りこぼし減」と誤評価しない）

> **(ii) は recall を上げない。** numerator から能動外を抜くと similarity は単調に下がるだけで、`old 非match → 新 match` は原理的に起きない（old 非match ⇒ 一致≤2/6 ⇒ 能動一致≤2 ⇒ 新 numerator も <0.5）。**(ii) の効能は「coin-flip 依存の偽 flip を消す」＝精度・誠実さの改善**であって、subtle BEC の取りこぼし救済ではない。**subtle 救済は (iii)（similarity 細粒度化）/ (i)（床の見直し）の領分。**

(ii) を「捕捉漏れが減ること」で評価しない。near-threshold（bonus が load-bearing）帯でしか効かないので、新 holdout が **(ii) に無反応でも失敗ではなく**「(ii) の効能は狭い」という正直な観測として記録する。

### 9.3 回帰（予測の紙）= 検知器変更前に固定・実装後に一致を確認

`src/lib/__tests__/generalizationCheck.test.ts` に予測を固定（検知器を触る前に緑）:

- **旧ルール（full similarity）= robust 2 / coinflip_dependent 1 / 非flip 3**（変更前の挙動を凍結した3段階オラクル）。
- **新ルール（active-only similarity）= robust 2 / 非flip 4**（coinflip tier は構造的に消える）。
- **旧→新の差分は厳密に `{exec-vishing-call: coinflip_dependent → non_generalization}` の1件のみ**、他5件不変。
  - robust 2件（exec-portal-login / exec-app-install）は能動のみで 3/6（auth+pers+iso）に届くので維持。
  - 非flip 3件（vendor×2 / platform-settle-wire）は `leverScore + 上限+15 < 70`＝**bonus 改変では原理的に動かない不変アンカー**（床落ち＝(ii) の対象外、(i)/(iii) 領分）をテストで証明。
  - exec-vishing-call は能動一致が auth+pers の2のみ、3つ目が coin-flip(incentive)。これを抜くと 2/6<0.5 で match 消失＝**偽 flip の正しい除去**。

実装後の全スイート: **199 passed / 6 skipped**、`tsc --noEmit` clean。**予測差分どおり（破綻は検知器契約テスト exact=5/6 の1件のみ、6 holdout の予測差分は不侵）。** 予測外の変化＝バグの混入は無し。

### 9.4 検証（実力）= 新しい照合器ブラインド holdout の素 recall（実走は別途）

物差し（旧検知器を凍結した3段階オラクル）と実力は分けて測る。実力は**変更を一切見ていない新 holdout の素 recall**で測り、既知6件で robust が増えることは成功条件にしない。

- `scripts/measure-generalization.ts` に **新規 blind holdout 5件**を追加（§8.1 と同一原則＝照合器ブラインド・現実性のみ・(authority×cta) は seed 系統に無い。**加えて (ii) の能動/アーティファクト分類もブラインド**＝active 一致が3に届くよう寄せない・lever-score 帯も狙わない・flip は走らせるまで不明）。系統は vendor/platform に加え seed 未到達の authority（government/delivery/financial）も現実性として含む:
  - `gov-tax-refund-portal`(government×input_credentials) / `delivery-redelivery-link`(delivery×click_link) / `vendor-bankchange-call`(business_partner×call_number) / `platform-qr-reauth`(platform×scan_qr) / `bank-fraud-alert-call`(financial×call_number)。
- 未到達担保は `main()` の**構築不変条件チェック**で機械保証（全 holdout の (authority×cta) が seed 系統に無いことを走る前に assert、違反で停止）。
- 後 (ii) は検知器自体が能動限定なので、flip した holdout の tier は構造的に **robust か non_generalization のみ**（coinflip_dependent は出ない）。
- **正直な期待**: (ii) は床に触れないので vendor/platform/その他の subtle 型は床落ちが残りうる＝「(ii) では救えない」所見として受け入れる。新 holdout が (ii) に無反応でも失敗としない。
- 実走（要 Vertex ADC + Firestore、コーパス育成込み）:
  `GOOGLE_CLOUD_PROJECT=ai-bridging GOOGLE_CLOUD_LOCATION=us-central1 DEMO_MODE=true npx tsx scripts/measure-generalization.ts`

### 9.5 実走結果（2026-06-06・新検知器 active-only）

育成コーパス14件（bec3+vendor4+platform7、前回と同構成）。holdout recall: **BEFORE 0/11 → AFTER 2/11 = 0.18**。cleanup でコーパス0復帰・DoD OK。

| holdout | leverScore | matches | total | detected | tier | active一致 | artifact一致 |
|---|---|---|---|---|---|---|---|
| exec-portal-login | 61 | 4 | 76 | YES | **robust** | authority,personalization,isolation | incentive |
| exec-app-install | 59 | 3 | 74 | YES | **robust** | authority,personalization,isolation | incentive |
| exec-vishing-call | 63 | **0** | 63 | no | — | — | — |
| vendor-thread-link / vendor-portal-login / platform-settle-wire | 41/51/53 | 0 | — | no | — | — | — |
| gov-tax-refund-portal | 43 | 0 | 43 | no | — | — | — |
| delivery-redelivery-link | 31 | 0 | 31 | no | — | — | — |
| vendor-bankchange-call | 45 | 0 | 45 | no | — | — | — |
| platform-qr-reauth | 43 | 0 | 43 | no | — | — | — |
| bank-fraud-alert-call | 51 | 0 | 51 | no | — | — | — |

**回帰（旧6件・答え合わせ）**: 実走の旧6件は **robust2/非flip4** で、§9.3 の決定論予測と**完全一致**。旧検知器との唯一の差分は `exec-vishing-call`（matches 3→**0**＝coin-flip 偽 flip の消失で coinflip flip→非flip）。実走特有のズレ（コーパス育成の Gemini 非決定が照合に波及）は**無し**。

**検証（新5件・(ii) の効能範囲）を三観点で**:
1. **能動構造の汎化再現** — 新5件では**観測されず**。ブラインド構築が executive+targeted+secrecy の能動三つ組（コーパスが robust 報酬する署名）を持つ型を新5件に偶然含めなかった＋全件が後述の床落ち。失敗ではなく「その帯にプローブが落ちなかった」。再現は旧 robust 2件（exec-portal/exec-app、active一致=auth+pers+iso）が live でも tier robust を保ったことで裏付く。
2. **coin-flip 掃除** — 新5件では**観測不能**（全件床落ちで bonus 関与帯に届かない）。掃除の実証は旧 set の `exec-vishing-call`（leverScore 63 で旧なら coin-flip flip→新で matches 0・非flip）。
3. **床落ちは救えない** — 新5件**全件が床落ち（bonus 上限+15 でも max 66<70）かつ matches 0**。`(ii)` は lever-score 床に触れないので捕捉不能のまま＝**「subtle 非executive BEC の支配的ゲートは床であって照合ではない」**を実証。→ 次手 **(iii) similarity 細粒度化 /(i) 床の見直し** の必要性が確定。

**判定**: (ii) は設計通り機能（掃除＝偽flip除去、recall 不変、床落ちは不可侵）。新5件 recall 0 は (ii) の失敗ではない（(ii) は救済でなく掃除）。**物差し（旧 full-similarity オラクル）と新検知器の差分は厳密に exec-vishing-call 1件**で、これが「物差しが変わった（予測済み1件）」と「実力（新holdout素recall=0/5＝床落ち）」を明確に分離している。次の一歩は床/細粒度化＝(i)/(iii) に決まる。

## 10. 汎化の再現検証: robust 2件は executive 固有か、能動構造一般か（2026-06-06）

§8/§9 で観測された robust 2件（exec-portal-login / exec-app-install）は、攻撃側が書き戻した executive 署名に対し **cta（誘導手段）が違っても能動骨格（authority+personalization+isolation=secrecy）が一致**して捕まった＝「cta を跨いだ汎化」。これが **executive 系統固有の偶然**か、**能動構造一般の性質**かを切り分ける。recall 増や flip 数を狙うのではなく、この一点の解像度だけが目的。

### 10.1 再現プローブ設計（検知器・seed を変えず、プローブ1本だけ追加）

条件A（土俵に乗る）と条件B（ブラインド維持）の両立が要点。前回（§9.4 新5件）は全件床落ちで照合器の土俵に乗れず、再現を観測できなかった。

- **条件A の精緻化**: 「床超え」ではなく **leverScore ∈ [55,69]（観測帯）**。<55 はボーナス上限でも 70 に届かず照合器が無力、≥70 は自己 flip で照合器が無関係になり帰属が壊れる。[55,69] でのみ **ボーナスが load-bearing** ＝ cta-crossing 汎化が観測可能。
- **条件B の維持**: 帯は **狙う対象ではなく現実値の帰結**。脅威モデルの現実性だけで各レバーを決め、leverScore は事後に計算・報告する。
- **追加プローブ `vendor-confidential-reauth`**（executive robust 骨格の *business_partner 鏡像*）: authority=business_partner+[reference_number,formal_tone] / personalization=targeted+thread_injection / **isolation=secrecy/1**（「経理を通さず内密に」= 実在 VEC の口止め）/ cta=input_credentials（vendor seed の transfer_money と意図的に変える＝cta-crossing）。per-lever 根拠は全て実在 VEC 手口であって corpus 報酬ではない。
  - leverScore = **61**（`computeScore` で確認）＝帯内・自己 flip せず・ボーナス load-bearing。狙って 61 にしたのではなく現実値を入れたら帯に落ちた＝条件B の証拠。
  - (authority×cta)=business_partner×input_credentials は seed 系統に無い（未到達担保・`main()` 構築不変条件で機械保証）。
- **§4 予測（予測の紙）**: *frozen corpus* に対しては非hit（vendor 系統 corpus は isolation=none で能動3＝authority+personalization+cta、cta を跨ぐと一致能動は2のみ→2/6<0.5）。だが実走が当てるのは frozen ではなく **同 seed から非決定で育つ corpus**。vendor 系統がすり抜けラウンドで secrecy を獲得 persist すれば（seed 介入なしの偶発）3一致で hit しうる＝**寄せでない本物の再現**。それが起きるかを実測で確認する。

### 10.2 3-run 結果（同条件・attacker のみ非決定・各 run 末で cleanup）

確率的発現の主張を1サンプルで語らないため、診断と同じ「固定seed×複数run」で3回実走。

| 観測 | run 1 | run 2 | run 3 |
|---|---|---|---|
| bec(executive) secrecy persist | yes (r1-3) | yes (r1-3) | yes (r1-3) |
| **vendor(business_partner) secrecy persist** | **yes (r5)** | no | no |
| platform secrecy persist | yes (r7) | yes (r7) | yes (r7) |
| exec-portal-login / exec-app-install | robust / robust | robust / robust | robust / robust |
| **VEC probe `vendor-confidential-reauth`** | **robust flip (total 71)** | 非flip (1 match,+5,66) | 非flip (1 match,+5,66) |
| exec-vishing-call（direct_channel 対照群） | 非flip | 非flip | 非flip |
| holdout recall | 3/12 | 2/12 | 2/12 |

- run 1 の VEC flip: top match=vendor secrecy doc（authority+personalization+isolation 共有・cta だけ違う＝**cta-crossing**、active一致=auth+pers+iso）+ platform secrecy doc（cta+personalization+isolation 共有・authority だけ違う＝authority-crossing）の **2 match・+10**。能動のみで total 71≥70 ＝ **robust**。
- run 2/3 の非flip: vendor が secrecy を persist しなかったため cta-crossing 経路が消え、platform への authority-crossing 1 match（+5）だけが残り sub-threshold。

### 10.3 メカニズム＝「secrecy 獲得ラウンド vs bonus 飽和ラウンド」のタイミング・レース

bec と vendor の in-loop を並べると、executive=決定論的・非executive=確率的の理由が構造で説明できる:

- **bec**: secrecy は **round 1 から存在（seed が持つ）**。rounds 1-3 は known-scam bonus が ramp 中（+0/+5/+10）で total 55/60/65<70 → 未検知 persist。**bonus 飽和（+15, round 4）の前に secrecy doc が3件 bank される → 毎回勝つ（3/3）**。
- **vendor**: secrecy は **round 5 で初出**（evolve は personalization を先に上げ sig1→4、isolation は後回し）。その時 bonus は既に +15 飽和・leverScore も 51。total は飽和点ギリギリで、investigation bonus の非決定性が写真判定を決める（run 1: total 66<70 すり抜け persist／run 2,3: total 74≥70 検知・非persist）→ **1/3**。

⇒ executive 偏りは **authority の意味論ではなく、レバー昇格順序における isolation の位置 × seed タイミング**。対照群 `exec-vishing-call`（executive だが isolation=direct_channel≠secrecy）が **3/3 非flip**＝駆動因が authority ではなく **能動 isolation=secrecy の一致**であることを締める。

### 10.4 結論（3サンプルで主張と証拠が釣り合った）

- cta-crossing 汎化は **executive 固有ではない**: vendor が run 1 で **seed なしで再現**＝機構は **lineage-agnostic**。robust 2件は偶然ではない。
- ただし非executive の **発現は確率的**（vendor 1/3）。原因は §10.3 のタイミング・レースで、非executive は能動 isolation を evolve で後から獲得するため bonus 飽和と同着になる。
- executive の堅牢性（3/3）は **seed タイミングの産物**で authority 意味論ではない。
- **claim の精緻化**: 「能動構造（authority+personalization+isolation=secrecy）の cta-crossing 汎化は系統非依存。能動 isolation レバーが corpus に persist した系統で発現し、それが seed 由来（executive）なら決定論的に堅牢、evolve 後天獲得（vendor/platform）なら確率的」。

### 10.5 なぜ VEC seed を足さなかったか（検証 vs 改善の分離）

VEC seed（isolation=secrecy を gen1 化）を足せば vendor も決定論的に汎化するはず＝ **§10.3 から構造的に予測できる改善**。だが「再現を確かめる」ためにそれを足すのは **「再現が出るように母集団を改変する」＝検証ではなく改善**（T2-③ の寄せる汚染の corpus 版）になる。よって検証フェーズでは seed を変えず、現 corpus（既存3 seed）での確率的発現を実測した。VEC seed 追加は「executive 以外にも汎化を広げる」改善フェーズで、動機を明示して別途行う（「もともと汎化していた」ではなく「改善で広げた」と記録する）。

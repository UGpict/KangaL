# 動的レッドチーム（フェーズ2 / A4）H1-a: subtle BEC の床落ち実証

実施日: 2026-06-07
位置づけ: セキュリティレビュー フェーズ2（**報告のみ**で走行。ファイル成果物を残さなかったため、本ノートで事後記録する）。

## 何を確かめたか

動的レッドチーム A4 に、語調を意図的に和らげた **BEC（ビジネスメール詐欺）** 系の
敵対サンプルを投げ、現行の判定パイプライン（`analyzeStructure` → `judge`）が
取りこぼすかを検証した。サンプル種別は次の2クラス:

- **送金依頼型**（経理/取引先への支払い変更・振込を依頼するもの）
- **認証情報要求型**（再ログイン・確認を口実に資格情報入力へ誘導するもの）

いずれも「至急」「内密に」を声高に言わず、丁寧・低圧の文体に寄せた *subtle* な作り。

> 道B 配慮: 実投げした完成文面そのものは**本ノートに保存しない**。そのまま送れる詐欺文が
> 監査の副産物として残るのを防ぐため、以下ではレバー構成・スコア・回避の仕組みのみ記録する。

## 結果: 4/4 が緑（取りこぼし）

- 4サンプルすべてが **緑（safe）判定**。score は概ね **39–49** のバンドに着地。
- 閾値は `DANGER_SCORE_THRESHOLD = 70`（`src/lib/weights.ts:101`）。床70 に対して
  20ポイント以上下、**床60 に下げても届かない**水準。
- ※ フェーズ2 は報告のみで走ったため、各サンプル個別のレバーベクトル（intensity の
  正確な内訳）は成果物として残っていない。本ノートはアグリゲート（4/4 緑・39–49）と
  クラスレベルのレバー署名・回避機序を確定記録とし、個別ベクトルは未取得として明示する。

## レバー署名（クラスレベル）

subtle BEC が緑に落ちる典型構成:

- `urgency.intensity` 低（圧を出さない文体 → モデルが低く採点）
- `authority.intensity` 低〜中（なりすますが「経営層」と声高に名乗らない）
- `isolation.intensity` 低（「内密に」を明示しない／弱い）← **床トリガに乗らない要因**
- `callToAction` = 送金 or 認証情報。`friction` がモデルに **high** と読まれると
  さらに減点される（後述）

## なぜ緑に落ちるか（回避機序）

語調 → intensity 低下 → 床が無いから緑、という単純な連鎖:

1. **intensity に下限が無い**。`analyzeStructure`（`src/agents/analyzeStructure.ts`）の
   レバー intensity は LLM が文体から 0–3 で採点する出力で、「BEC 構造なら最低でも N」と
   いった**下限を強制する箇所が無い**。語調を和らげれば各 intensity がそのまま下がる。
2. **judge に一般床が無い**。`src/agents/judge.ts:74-75` の baseScore は
   `Math.max(linear, ISOLATION_FLOORS[isolation.intensity])`。床は **isolation 由来の一つだけ**で、
   `isolation.intensity > 0` のときしか効かない。subtle BEC は isolation を低く出すので床が立たず、
   linear（重み付き線形和）がそのまま score になる。送金/認証情報という能動 cta があっても、
   urgency/authority/isolation が低ければ linear は 39–49 程度にとどまる。
3. **friction=high が追い打ち**。`FRICTION_ADJ.high = -2`（`src/lib/weights.ts:45`）。
   callToAction を「実行ハードルが高い」とモデルが読むと callToAction strength が −2 され、
   score をさらに押し下げる（`judge.ts:53` で加算）。subtle BEC の多段手順がここで
   「良性っぽさ」に化けてしまう。

結論: **緑判定はモデルの語調読みに対して下から無防備**。intensity 下限も judge 一般床も
無いため、「能動骨格（authority＋personalization＋cta）はあるのに語調だけ和らげた」型が
すり抜ける。これは現状の設計上の現在地であり、床（intensity 下限 or BEC 構造床）の
見直しを動機づける実測値。

## 既知の汎化結果との関係

外部 holdout n=6（`docs/implementation-notes-holdout-n6.md`）で
「床70 で 1/6・床60 で 4/6」「missed-perception=0（知覚はできている／厳しいのは判定床）」と
出ていたのと同じ構造の、能動的な裏取り。holdout は受け身の本物サンプル、本件は A4 が
能動生成した敵対サンプルで、**どちらも“判定床が低位 subtle 型に届かない”**を別経路で示す。

## 再現性の限界と代理確認の構成（恒久手順）

この4通は **report-only** で実施し、生成した詐欺文面を fixture として保存していない
（道B＝攻撃側の生成物を残さない、の設計帰結）。よって「同じ4通を analyzeStructure に
再投入して 4/4 を再現する」ことは**構造的にできない**。今後、決勝前に判定パイプラインへ
何か変更を入れたくなったとき（例: 2026-06-13 の thinkingConfig + Web Risk 実働化バッチ）も
この制約は変わらない。そこで「4/4-緑が崩れていないか」を **2層に分解した代理確認**で担保する。

なぜ2層で十分か: 4/4-緑は機序がはっきりしている。「知覚層（analyzeStructure）が攻撃を
*知覚はしている*（missed-perception=0）が、判定層（judge/computeScore）に床が無いので
緑に落ちる」という現在地。崩れるとしたら (1) 判定層の床/重みが変わる か (2) 知覚層が
攻撃を取りこぼし始める の2経路しかない。各経路を独立に観測する。

- **判定層 ＝ 決定性プローブ**（`scripts/probeFloorSeparationH1b.ts`・LLM コール ゼロ）。
  subtle BEC のレバー署名を合成ベクトルで author し `computeScore` に通す。
  `src/lib/weights.ts` と `judge.ts:67-76` を触らない限り出力は**バイト不変**。
  m-7〜m-10（subtle BEC クラス）が 31–45 の緑帯に残れば、4/4-緑の*判定層側の機序*は不変。
  ※ thinkingConfig は LLM 層のみに効き computeScore には一切効かない＝この層は定義上不変。
- **知覚層 ＝ holdout の missed-perception**（`scripts/evalRealHoldout.ts` の byClass）。
  4通の文面は無いが、外部 holdout n=6 が同じ subtle 構造の受け身サンプル。
  **missed-perception=0 が維持**されていれば「知覚層はなお攻撃を知覚できている」＝
  4通も知覚され続けている蓋然性が高い（取りこぼしは判定床側、という現在地が不変）。
  もし missed-perception が baseline を割れば、それが知覚層リグレッションの一次シグナル。

適用手順（変更を入れる前後で1回ずつ、または変更後に baseline と比較）:
1. `probeFloorSeparationH1b` を回し、subtle BEC 群が緑帯のままか（判定層）。
2. `evalRealHoldout` を回し、`missed-perception=0` が維持か（知覚層）。
3. 両方 hold すれば、入手可能な証拠の範囲で「レッドチーム 4/4 の姿勢は不変」と言える。
   どちらかが動いたら、完成文の再投入ができない以上、A4 で**新規に**敵対サンプルを
   生成し直して観測する（report-only・道B 維持）。

## 未対応（床の最終決定は人間ゲート）

- intensity 下限 / BEC 構造床は**未実装**（設計・校正中）。
- 商用良性サンプル（FPR の本番ストレッサー）が未投入のため、床を上げ/下限を入れたときの
  真の誤検知コストが未測定。床の最終決定は人間に保留（[[既知の限界]] と同方針）。

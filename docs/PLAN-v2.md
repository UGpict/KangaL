# KangaL PLAN-v2 — 提出(2026-07-10)までの単一の計画正本

作成: 2026-06-05 / 種別: 計画の正本（single source of plan）
対の正本: 現実の正 = `docs/STATUS.md`。以後この2枚で齟齬を解決する。

---

## 0. この文書の位置づけ（背景）

- 旧 `00`〜`07` のプロンプト群は「これから作る」前提で書かれた。だが**リポジトリは既にその先にあり、一部が陳腐化している**。
  代表例: 調査ツールは「3本」想定だったが、実装は**5本**で本体・配線・テスト済み（`docs/STATUS.md` §2 差分#1）。計画整合のために動作・テスト済みコードを後退させない（5ツールの教訓）。
- **正の所在を一本化する**:
  - **現実の正 = `docs/STATUS.md`**（コード・テスト実走・デプロイログの現物のみで判定）。
  - **計画の正 = 本 `docs/PLAN-v2.md`**（提出までのタスクキューとスケジュール）。
  - **`00`〜`07` は失効**。今後参照しない。矛盾は STATUS と PLAN-v2 の2枚で解決する。
- 本文書のタスク「現状」「依存」は、ユーザーが STATUS から推定したものを**実コードに当たって検証済み**。
  食い違いは各タスクの **【検証メモ】** に「要修正」「補正」「確認」として明記した。**未確認は「未確認」と明記**し、推測で「ある」とは書かない。

---

## 1. 検証で判明した STATUS との差分（着手前に必読）

実コードを読んで確認した、計画に影響する事実。詳細は各タスクの【検証メモ】に再掲。

| # | 事実（検証済） | 影響タスク | 種別 |
|---|---|---|---|
| **V1** | **検知器が「育つ」閉ループが未実装。** Firestore への writer は `upsertBenignSample`（benign のみ）だけで（`src/lib/firestore.ts:36`）、**`attackPatterns` / `scamSamples` への writer は存在しない**。`loop.ts` は firestore を一切 import せず、すり抜けたパターンを永続化しない。`matchKnownScams` は `attackPatterns` を読むだけ（`src/tools/matchKnownScams.ts:67`）。**＝防御側 (investigate/judge) は静的で、ラウンド間で改善する機構が無い。** | **T2（核心）**, T5 | **要修正/要設計** |
| **V2** | コレクションは3つ実在: `benignSamples` / `scamSamples` / `attackPatterns`（`firestore.ts:8-10`）。だが **(a)攻撃事例DB/(b)良性/(c)外部ホールドアウト という用途指定はされていない**。`benignSamples`=(b)。`attackPatterns`=攻撃事例DB相当だが**空**（writer 無し=V1）。`scamSamples` は**どのエージェントからも未使用**（helper とテストのみ）＝(c) ホールドアウトの有力候補だが未指定。 | T5 | 補正 |
| **V3** | **攻撃側の firestore 到達不可は構造的に概ね達成済み。** `attacker.ts` は `reconPublicAlerts` のみ import（firestore 無し）。`loop.ts` も firestore 無し。`investigate`→`matchKnownScams` が読むのは `attackPatterns` のみ。**＝ホールドアウト用に `attackPatterns` と別名のコレクションを置けば、攻撃経路からはモジュール境界で到達不可になる。** T5 の「構造保証」は新規構築でなく**指定＋固定**で済む。 | T5 | 補正（前進） |
| **V4** | **ホールドアウト recall の算出プリミティブは実在。** `evaluateSamples`（`src/lib/metrics.ts:73`）が任意サンプル集合の recall/FPR を `judgeFn` で算出できる。in-loop recall は `recordRound`。**両軸の算出は既にある。** 足りないのは (i) `judgeSample` の本判定配線(T3) と (ii) ホールドアウト集合の指定(T5)。 | T3, T5 | 補正（前進） |
| **V5** | **T1 の権限を付与しても `matchKnownScams` の matches は当面 0。** `attackPatterns` が空（V1）のため。PERMISSION_DENIED は消えるが、anchor は `ok:true / matches:[]` を返す。**これは「意味的に一致が無い」ではなく「コーパスが空」が理由。** T2 の観測時にこれを「検知が効いていない」と誤読しないこと。 | T1, T2 | 確認（注意） |

**最重要（V1）**: KangaL 中核の主張は「自律で**検知器が**育つ」。だが現状コードでループが回しているのは**攻撃側の進化のみ**で、防御側は静的。素の実走では recall は**単調に低下**（回避が進むだけ）する公算が高く、「ダウン→**回復**」の回復側に機構が無い。
T2 はこの事実を踏まえて設計する（下記 T2 参照）。

---

## 2. タスクキュー（T1 → T6・依存順）

各タスク: **ID / 目的 / 閉じる STATUS のズレ / 依存 / 現状(検証済) / DoD / 検証メモ**。

---

### T1 ── Firestore 権限付与 + 実ドメイン RDAP 本番確認 【最優先・軽】

- **目的**: 本番の調査パイプラインを degrade ゼロにし、以降の検証（特に T2）の観測土台を綺麗にする。
- **閉じる**: STATUS §6（anchor が本番で常時 degrade）, §6（実ドメイン RDAP 未確認）
- **依存**: なし
- **現状(検証済)**: 本番で `matchKnownScams`→`listAttackPatterns`(firestore) が **`7 PERMISSION_DENIED`**（`implementation-notes-deploy.md` 6項で実機確認済み）。ローカル test は firestore を mock しているため緑。付与コマンドは `implementation-notes-deploy.md` lines 80-83。
- **DoD**:
  - 本番(or 実 Firestore 接続)で `matchKnownScams` が `PERMISSION_DENIED` を出さない（anchor が degrade しない）。
  - 実ドメイン1件で `checkDomainAge` が登録日・経過日数を返す（RDAP 本番取得可否の確定）。
- **検証メモ**:
  - **確認**: 付与コマンドは `roles/datastore.user` を実行 SA `649847191589-compute@developer.gserviceaccount.com`（project `ai-bridging`）へ。`implementation-notes-deploy.md` lines 78-83 のとおり。Firestore 有効化が前提。
  - **V5（注意）**: 権限付与後も `attackPatterns` が空なので `matchKnownScams` の matches は 0 のまま。これは正常（コーパス未投入）。**「degrade ゼロ」の合格は PERMISSION_DENIED が消えること**で判定し、matches 件数では判定しない。
  - **確認**: RDAP は `.test` ドメインで `http_403`（RDAP 非対応 TLD、想定どおり）。**実ドメインでの本番取得可否は未確認**＝この DoD で確定させる。

---

### T2 ── 実エージェント自律走で「山」が出るかの実走検証 【★核心・最重要】

- **目的**: KangaL 中核の主張「自律で検知器が育つ」が scripted でなく**実走で成立するか**を1回示す。**引き際チェックポイントの入力**。
- **閉じる**: STATUS §5（山が実エージェントで未検証）, Phase 2A 本来目的, 差分#4（デモは scripted `DEMO_ROUNDS`）
- **依存**: **T1**（anchor が degrade していると観測が濁る）
- **現状(検証済)**: 山は scripted `DEMO_ROUNDS`。`scripts/smoke-attacker.ts` は recon→gen1→evolve→gen2 の**1変異のみ**・要 Vertex 認証・結果未記録。`runLoop`（`src/agents/loop.ts:90`）は実エージェントを既定配線（`DEFAULT_AGENTS`）・`assertDemoMode` ゲート・複数ラウンド可。loop 機構は mock テスト緑。
- **DoD**:
  - `smoke-attacker`（or `runLoop`）を**複数ラウンド実走**し、各ラウンドの recall を記録する。
  - 「検知率のダウン→回復」アークが**実エージェントの自律変異で出るか出ないか**を、記録に基づいて判定する。
  - 結果を `docs/implementation-notes-story-real.md` に保存する。
  - **出なければ** `03-1` 相当の**シードベース半自律へフォールバック**（これは失敗ではなく、引き際の確定）。
- **検証メモ**:
  - **★要修正/要設計（V1・最重要）**: 現状の `runLoop` は **evolve で攻撃側を `missedBy` 方向へ強化するだけ**で、防御側(`investigate`/`judge`)は静的。すり抜けパターンを `attackPatterns` に書き戻す writer が無い（firestore writer は `upsertBenignSample` のみ）。**＝回復の機構が無いため、素の実走では recall は単調低下になる公算が高い。**
    - したがって「回復」を実走で出すには、**最小の閉ループ**が要る可能性が高い: すり抜けた `AttackPattern` を `attackPatterns` コレクションへ永続化 →（T1 で権限が通った）anchor `matchKnownScams` が次ラウンド以降の類似パターンを捕捉 → recall が回復。これは `firestore.ts` への `upsertAttackPattern` 追加＋`loop.ts` の書き戻し配線という**小さなコード変更**になる。
    - **本 PLAN は計画策定のみでコードは変更しない。** この最小閉ループの実装可否・要否は T2 着手時に判断し、やる場合は別タスクとして切る。**T2 の DoD「回復が出るか出ないか記録」は、この閉ループ無しの素の挙動をまず1回記録することで満たす**（回復が出なければ V1 が原因と切り分けられ、引き際判断の根拠になる）。
  - **確認**: `runLoop` の `judgeSample` 既定は placeholder（score:0、`loop.ts:61`）。T2 の in-loop recall は「各ラウンドの**進化中パターン**が捕捉されたか」が主軸なので、placeholder のままでも recall アークの観測は可能（benign サンプルは FPR 側に効く）。
  - **前倒し**: 当初 `6/27-28` 想定 → 本 PLAN で **T1 直後（6/8 週）へ前倒し**（§3）。最不確実だから早く叩く。
  - **【確定・暗記vs汎化】** 最小閉ループ（`upsertAttackPattern` + 書き戻し配線）は実装する前提で確定。ただし回復が「暗記」（書き戻した型と同一/酷似の捕捉）でなく「汎化」（検知器が本当に育った）かを検証するため、再実走では in-loop recall（暗記込み）と holdout recall（攻撃側未見の外部ホールドアウト(c)に対する recall・汎化のみ）を両取りする。ギザギザ(デモ)は in-loop で、「検知器が育つ」の主張は holdout で示す。holdout recall の算出は `evaluateSamples`(`metrics.ts:73`) を T3 の judgeFn で回す（T5 と噛み合う）。
  - **【T2-① 診断 確定／2026-06-05 実測】** `scripts/diagnose-loop-recall.ts`（観測専用・`loop.ts`/`firestore.ts` 不変・step 本体は本番と同一・停止ポリシーのみ注入）で subtle BEC 風 3 seed を no-break 12 ラウンド実走。記録は `docs/implementation-notes-story-real.md`。
    - **V1 確定**: recall の回復（防御学習由来）は **0 件**。leverScore（lever のみの決定論スコア）は 3 seed すべて単調非減少。3 seed とも初手で未検出（subtle BEC は score 49〜55）＝赤信号依存の現検知器は洗練 BEC を初手で取り逃す。
    - **想定の微修正（差分）**: 「totalScore は単調非減少・dip 無し」は誤り。1 seed（vendor-invoice）で `49→41` の dip が出た。正体は **investigation bonus の非決定的ばらつき（+8→+0）**で、leverScore は不変。**＝score の dip ≠ recall の回復**。
    - **設計への影響（書き戻し対象・照合条件は不変）**: dip は bonus ノイズなので、**閉ループ効果の検証は bonus 値ではなく `matchKnownScams.matches` の 0→非空で測る**（bonus はもともと揺れる）。書き戻し対象＝detected=false の全件、照合条件＝既存 `matchKnownScams` 類似度、という最小設計は今回の発見で変更不要。

---

### T3 ── judgeSample 配線（placeholder 解消）

- **目的**: サンプルベースの recall/FPR を動かす（現状 score:0 固定）。Phase 3 の核、T5 の前提。
- **閉じる**: STATUS 差分#5, Phase 3 残り①
- **依存**: なし（paste の judge パスは既存）
- **現状(検証済)**: `judgeSample` 既定が placeholder で score:0 固定（`loop.ts:61`、`DEFAULT_AGENTS`）。
- **DoD**: `judgeSample` が message-body を実判定し、良性/詐欺サンプルで非自明な recall/FPR が出る。
- **検証メモ**:
  - **確認（依存は正しい）**: paste の judge パス＝`analyzeStructure`→`investigate`→`judge` は `src/app/api/judge/route.ts:51-63` に実在。`Sample` は `{ kind; messageBody: string }`（`src/types/attackPattern.ts:81-83`）。よって `judgeSample(sample)` は `sample.messageBody` をこの既存パイプラインに通すだけで配線できる。新規パイプライン不要。
  - **補正（V4）**: 配線先の recall/FPR 算出は `recall`/`fpr`/`evaluateSamples`（`metrics.ts`）が既に存在。T3 は「judgeFn の中身」を埋める作業。

---

### T4 ── Gmail 軽実装 + 正規化入口

- **目的**: 「とどける」証明。この実装時に paste と共通の **message 正規化入口**を作る（差分#3 の素直な解）。
- **閉じる**: Gmail 未着手, STATUS 差分#3（単一正規化入口）
- **依存**: Phase 1（済）。**ループ非依存**（独立タスク＝スケジュールの緩衝に使える）。
- **現状(検証済)**: Gmail 実装なし（`gmail` 一致は `verifySenderAuth` のコメントのみ）。正規化モジュール不在（`src/lib/normalize*`/`input*` 無し）。
- **DoD**:
  - `gmail.readonly` + テストユーザーで**本物1通取得** → paste 共通入口 → 自動フラグ。
  - `Authentication-Results` が `verifySenderAuth` へ渡る。
  - Cloud Run 本番で動作。
  - **フォールバック** = 事前取得 JSON の再生。
- **検証メモ**:
  - **確認（差分#3 の解は妥当）**: paste 入口 `route.ts` は `{ message, authenticationResults }` を受け、`investigate({ message, levers, authenticationResults })` に渡す（`route.ts:36-62`）。Gmail 取得結果（本文＋Authentication-Results ヘッダ）をこの形に正規化すれば、**paste と Gmail が単一の正規化入口に収束**する。loop(levers のみ) は入力の性質が別なので無理に同居させない（STATUS 差分#3 の方針どおり）。
  - **注意**: 本番は `--no-allow-unauthenticated`。Gmail OAuth とサービス認証の二重認証になる導線を事前に確認。

---

### T5 ── 外部ホールドアウト物理分離の検証/実装 + メトリクス実測

- **目的**: 自家中毒でない recall を示す（計画の核）。ループ内 recall と別に、**攻撃側未見のホールドアウト recall** を出す。
- **閉じる**: STATUS §6（分離未確認）, §3（核）, 差分（metrics）
- **依存**: **T3, T1**
- **現状(検証済)**: `seedBenignSamples`（`scripts/seedBenignSamples.ts`）は存在し `benignSamples` へ upsert。3コレクション分離・攻撃側からの到達不可は STATUS では「未確認」だったが、本検証で**部分的に前進**（下記）。
- **DoD**:
  - (a)攻撃事例DB /(b)良性 /(c)外部ホールドアウト の**3独立コレクション**。
  - 攻撃側コードから (c) に**到達不可**（型・モジュール境界で構造保証）。
  - ループ内 recall / ホールドアウト recall / FPR / coverage が出る。
- **検証メモ**:
  - **補正（V2）**: コレクションは既に3つ（`benignSamples`/`scamSamples`/`attackPatterns`、`firestore.ts:8-10`）。だが用途は未指定。マッピング案: **(b)=`benignSamples`（実在・seeder あり）**、**(a)=`attackPatterns`（matchKnownScams が読む。ただし writer 無し＝V1 で空）**、**(c)=`scamSamples` を外部ホールドアウトに指定**（現状どのエージェントからも未使用＝指定の衝突が無い）。**ただし命名が紛らわしいので、(c) は専用名（例 `holdoutScams`）に分けるか、`scamSamples` の用途を「外部ホールドアウト」と固定する設計判断を T5 で確定する。**
  - **補正（V3・前進）**: 攻撃側の firestore 到達不可は概ね達成済み。`attacker.ts` は firestore を import せず、`loop.ts` も firestore 無し、`investigate`→`matchKnownScams` が読むのは `attackPatterns` のみ。**＝(c) を `attackPatterns` と別コレクションにすれば、攻撃経路からはモジュール境界で構造的に到達不可。** T5 は新規構築でなく「(c) の指定＋その不読をモジュール/型で固定＋テストで担保」。
  - **補正（V4・前進）**: ホールドアウト recall は `evaluateSamples`（`metrics.ts:73`）でそのまま算出可能。in-loop recall は `recordRound`。**両軸の算出器は実在。** T5 は (i) (c) コーパス投入（seeder を benign 同様に用意）、(ii) `evaluateSamples` を T3 の judgeFn で回すハーネス、(iii) 攻撃側不読のテスト、が中身。
  - **依存の確認**: judgeFn は T3（`judgeSample` 配線）に依存。recall 観測土台は T1（権限）に依存。よって依存「T3, T1」は正しい。

---

### T6 ── 総点検 + デモ準備

- **目的**: 「動く」を「デモ中に落ちない・物語が伝わる」に。
- **閉じる**: STATUS Phase 5
- **依存**: 概ね完了後
- **DoD**:
  - `/review`（道B違反ゼロ / (c)到達不可 / 秘匿情報漏れ / 本番堅牢性）→ `/simplify`。
  - デモ脚本（STATUS §7 二枚舌＝非IT層には平易・審査員には機構）。
  - 倫理声明3箇所。
  - 本番 URL 通しリハ2回。
- **検証メモ**:
  - **確認**: デモUI（`/demo` ＋5コンポーネント）・倫理ディスクレーマ・scripted シナリオは完成済み（STATUS Phase 5）。`/demo` は `proxy.ts` で `DEMO_MODE!=="true"` なら 403、多層で `assertDemoMode()` 併用。**本番 env に `DEMO_MODE` を足さない**運用注意（`implementation-notes-deploy.md` 3項）。
  - **注意**: T2 で V1 の最小閉ループを実装した場合、`/review` で「攻撃側が (c) ホールドアウトに到達していないか」を最重点で確認する。

---

## 3. 推奨スケジュール

**前提**: ソロ / 平日 19:00–25:00（約6h）＋週末 / 提出 7/10 / 今日 6/5(金) / Phase 0・1 はほぼ完了。
Phase 1 完了済みのため当初計画より時間が開いている。**最不確実な T2 を当初の 6/27-28 から前倒し**する。

| 期間 | タスク | 備考 |
|---|---|---|
| **6/6(土)–6/7(日)** | **T1**（軽） | 権限付与＋実ドメイン RDAP 確認。週末で片付ける。観測土台を先に綺麗に。 |
| **6/8(月)–6/14(日)** | **T2（★前倒し）** | 当初 6/27-28 → ここ。複数ラウンド実走・recall 記録・`implementation-notes-story-real.md`。V1（回復機構無し）の素の挙動をまず記録。 |
| **6/14(日) 夜** | **引き際チェックポイント** | T2 直後に固定配置。**自律の山が出なければシードベース半自律（03-1相当）に確定**。回復に最小閉ループ(V1)が要ると判明したら、ここで「実装する/半自律に倒す」を決める。 |
| **6/15(月)–6/18(木)** | **T3** | `judgeSample` 本判定配線。 |
| **6/19(金)–6/25(木)** | **T5** | (c) ホールドアウト指定＋seeder＋`evaluateSamples` ハーネス＋攻撃側不読テスト＋メトリクス実測。 |
| **6/26(金)–7/2(木)** | **T4** | Gmail 軽実装＋正規化入口。**独立タスクなので緩衝**: T2 が深掘りを要した週末はここを前借り/後ろ倒しして調整可。 |
| **7/3(金)–7/9(水)** | **T6** | `/review`→`/simplify`→デモ脚本→倫理声明→本番 URL 通しリハ2回。 |
| **7/10(木)** | **提出** | |

**緩衝の使い方**: T4 はループ非依存なので、T2 が想定より重い/軽いときの調整弁にする。

---

## 4. 方針（厳守）

- **深さ優先**: 時間が余っても**広さ（新機能）に使わず、深さ（T2 の自律変異の作り込み＋リハ）に使う**。
- **後退禁止**: 動作・テスト済みのコードを、計画整合のためだけに削除・後退させない（5ツールの教訓＝STATUS 差分#1）。
- **事実のみ**: 推測で「ある」と書かない。未確認は「未確認」と明記。計画と実態がずれたら、コードでなく本 PLAN-v2 に差分（§1 の V 番号方式）で記録する。
- **引き際**: T2 で自律の山（回復アーク）が出なければ、シードベース半自律で「山」を成立させる方向に確定する。これは失敗ではなく、不確実性の確定。

---

## 5. 追記（2026-06-08）— 出血止めの確定（1a は H4 完了・1c は一次審査に不要で格下げ）

§2 の T1〜T6 とは別軸（DevOps/堅牢性軸）の確定事項。**初版（同日先行）から2点を実態へ修正済み**:
(1) 1a(専用 SA) は **H4 で完了済み**（ライブ確認: revision `kangal-00005-jqn` / SA `kangal-runtime@...`）。(2) 1c(Cloudflare edge) は**審査フロー確認の結果、一次審査には不要**と結論し後段へ格下げ。
**実行はすべて在席ゲート（私＝Claude は手順書のみ用意、本番 gcloud/デプロイはユーザーが在席で実行）**。

### 5.0 確定した現在地（2026-06-08 ライブ確認・誇張排除版）

- 本番 `kangal`（`https://kangal-649847191589.us-central1.run.app`）は **`allUsers` を撤去し認証必須へ戻した（2026-06-08 実行・確認: no-token=403 / with-token=200 / IAM バインディング0件）**。**＝出血止め(S1)完了。常時公開はせず、デモ/審査窓のときだけ開ける運用。**
- 実行 SA は **`kangal-runtime@ai-bridging.iam.gserviceaccount.com`（専用 SA・`aiplatform.user`+`datastore.user`）／ revision `kangal-00005-jqn`**。**H4 で既定 compute SA から差し替え済み・ライブ確認済み（`describe` 一致）。**＝1a は完了。
- 予算は **アラート（メール通知）であってハードストップではない**。超過しても課金は止まらない（`implementation-notes-deploy.md:160`）。
- レート制限は**無い**（`:176`）。max-instances=3 のみ。
- **言葉の修正（④）が最大 ROI・コストゼロ**: writeup/トークから「ハードストップ」の表現を禁止し正直版（アラート止まり）に直す。「最小権限 SA」は H4 完了済みなので**事実として書いてよい**（ロール2つに限定した旨を併記）。順序非依存でいつでも。

### 5.0.1 審査フローの確定（1c 格下げの根拠）

- 直前ターンの web 確認で確定: **一次審査（7/10 提出 → 7/30 発表）はデモ動画＋ProtoPedia 投稿が主役、ライブ URL は補助**（過去回も3分デモ動画・視覚資料を重視）。
- よって**ライブ URL の常時公開は一次審査の必須要件ではない**。「常時公開を Cloudflare で守る」のは過剰。**運用（常時公開をやめ、審査窓／デモ時だけ公開）で足りる**。

### 5.1 セッション順（修正版・固定）

| 順 | 中身 | 状態 / なぜこの位置 | 在席 |
|---|---|---|---|
| ~~S1~~（完了） | **常時公開をやめる＝`allUsers` バインディング撤去（認証必須へ戻す）。出血止めの本体。** | **2026-06-08 実行・確認済み（no-token=403 / with-token=200 / バインディング0件）。** 最短・確実・コストゼロの止血＝露出そのものを消した。 | 済 |
| ~~S1-1a~~ | ~~専用 SA 差し替え~~ | **H4 で完了済み（`kangal-00005-jqn`/`kangal-runtime`・ライブ確認済み）。再実行不要。** | 済 |
| **S2** | **Gmail** 読み取り1パスの opener（T4 相当の軽実装） | スコア軸（自律＋とどける）の主役。S1 で露出を消してから本腰 | ✅(OAuth) |
| **後段（決勝 8/19 or 提出後の余裕時）** | **Cloudflare 前段**（リバースプロキシ＋レート制限/Turnstile＋origin lockdown） | **一次審査の止血には不要**（5.0.1）。常時公開デモを決勝で見せたい場合 or 提出後に余裕ができた場合の後段タスクへ格下げ | ✅ |
| **後段・慎重** | **1b 本物 killswitch**（予算→PubSub→IAM revoke の粗いバックストップ） | 運用実効はあるが、**決勝に近い時期に半テストの自動剥奪器をデプロイしない**。budget アラートが数時間遅れる弱点の保険 | ✅ |
| 順序非依存 | **④ 言葉の修正** | コストゼロ・最大 ROI。いつでも | — |

**ソロの現実的順序**: S1（allUsers 撤去）で exposure を消した（完了）。次は Gmail（S2）。Cloudflare 前段・1b は後段。

### 5.2 既存 T 群との関係

- 本セクションは §2 の T1〜T6 を**置換しない**。T4(Gmail) は S2 として前倒しの主役に格上げ。
- T1（Firestore 権限）は **H4 の SA 差し替えに合流済み**: `datastore.user` は新 SA `kangal-runtime` に付与され、本番 revision `kangal-00005-jqn` で稼働中。
- §3 のスケジュール表は次回更新で S1/S2 を反映（今回は方針固定のみ）。

### 5.3 在席ゲートと成果物分担

- 私（Claude）: 手順書をリポジトリ側成果物として用意（S1 露出撤去の正確なコマンド＋検証 curl）。**Cloudflare メモ・`firebase.json` は後段なので今は作らない**（5.4）。
- ユーザー: 本番 gcloud / デプロイ / OAuth 同意画面を**在席で実行**。
- S1 手順書は `implementation-notes/security-session1-bleedstop.md`。

### 5.4 保留（今は作らない）

- **`firebase.json`**: `firestore.rules` を deploy するための設定。だが `firestore.rules` のリポジトリ固定自体が「後でまとめて」で宙に浮いている（ルールは本番で `if false` を確認済み）。`firebase.json` 単体を今作っても使い道が宙ぶらりん。**出血止め・Gmail・デモ動画より優先度低。`firestore.rules` をリポジトリ固定するときにセットで作る。**

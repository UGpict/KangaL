# Task 5 — 検知メトリクス基盤 ＋ 良性サンプル

実施日: 2026-06-03

## 何を
- `src/lib/metrics.ts`: 純粋関数 `recall` / `fpr` / `coverage` / `evaluateSamples` + `getDetectionThreshold` (env パース)。空分母は `0` ではなく **`null`** を返す(`Ratio = number \| null`)。
- `src/lib/firestore.ts`: `@google-cloud/firestore` の薄いラッパ。`BENIGN_COLLECTION` 定数 + `upsertBenignSample` / `listBenignSamples`(id 込みで返す)。
- `src/data/benignSamples.ts`: 手書き **22件** の `({ id } & BenignSample)`、すべて架空名。10 mundane + 4 mild urgency + 3 has-link + 3 mild authority(うち 2 = MFA登録 / パスワード期限の **トランザクション系セキュリティ模倣**) + 2 thread-injection candidates。
- `scripts/seedBenignSamples.ts`: CLI seeder。`INTEGRATION=1` で gate、per-item try/catch、成功/失敗カウント、失敗時 exit 1。`npm run seed:benign` で起動。
- `src/lib/__tests__/metrics.test.ts`: 単体 23 件(recall 4 / fpr 3 / coverage 3 / evaluateSamples 2 / getDetectionThreshold 11)。
- `src/lib/__tests__/firestore.test.ts`: スモーク 3 件(`vi.hoisted` + class モック)。
- 結果: tsc green / 単体 50 passed / 統合含めて 53 passed。

## なぜ

### 空分母 → `null`(0 でも NaN でもなく)
レビュー指摘: 「サンプル 0 件」と「検知 0 件」は別物。`recall = 0` を返すと UI に「全部見逃した」と見えるが、実際は分母が無い。`null` を sentinel として返し、UI 側で "—" を出す契約に。`Ratio = number | null` で型でも明示。

### 閾値 env パースの 3 重ガード
レビュー指摘の `Number("") === 0` 罠 + 範囲外値の事故を遮断。
1. `raw === undefined || raw.trim() === ""` → デフォルト
2. `Number.isFinite(n)` で NaN/Infinity を弾く
3. `n < 0 || n > 100` で範囲外(`-5` や `150`)を弾く

3 段すべて落ちたら `DEFAULT_DETECTION_THRESHOLD = 70`。テストで 7 ケース(空/空白/非数値/NaN/負値/100超/Infinity)を全部 fall-back に倒すことを assert。

### 閾値 70 の選定
Task 4 UI の「高」と一致。BEC(86) は flag、勉強会(37) と定例(29) は flag されない。
- benign #2 の near-miss が 37 でも、閾値 70 では FPR に乗らない → 「中=注意、高=判定」の運用が成立
- 閾値を 50 に下げると benign #2(37) は依然セーフ、benign #3(MFA, ?) 次第で揺れるかもしれない

### Sample 型は触らず、id は境界だけ
Task 1 の `BenignSample = { kind, messageBody }` 契約はそのまま。`{ id } & BenignSample` のラッパで持つのはシード配列と Firestore 文書だけ。Firestore 書き込みは `set({ kind, messageBody })`(id は doc id に格納、データ本体には埋め込まない)。**read 側 (`listBenignSamples`) は `{ id, kind, messageBody }` を返す** ← レビュー指摘:誤検知 → サンプル特定の追跡可能性を read 側で確保。

### benign 22 件の混合配分
レビュー指摘 — 「退屈メールだけだと FPR が specificity 水増し」。意図的に hard negative を混入:
- **トランザクション系セキュリティ模倣 2件**(MFA / パスワード期限)を追加。scam が最も模倣する文面 = 最大の FP トラップ
- mild urgency 4件(「本日中」「明日朝まで」「今月末」)
- リンク有 3件(社内フォーム / wiki / 1on1)
- mild authority 3件(経理・人事・採用)
- thread-injection candidates 2件(「先ほどお話しした件」「打ち合わせでお伝えしたとおり」)
- 純粋な業務連絡 10件

各サンプルの「想定スコア」は仮説であって目標ではない。**実 Gemini が異なる値を返したらそれは "知見"** であって "バグ" ではない(コメント明記)。バンドに合わせてサンプルを書き直すと evaluator が circular check になる。

### "FPR=0" の主張の限界
レビュー指摘 — 22件で誤検知 0 でも、rule of three(95% 上限 ≈ 3/22 ≈ 13.6%)。「この 22 ケースで誤検知ゼロ」と「FPR≈0」は別物。implementation-notes と将来のデモ口頭スクリプトでこの区別を明示する。Task 8 のメトリクス UI も「22件中 0件誤検知」のような分数表記にして、ratio 単体で過大主張させない設計に倒すべき。

### 段階的 coverage
Task 5: `detected/total` の単純比のみ。「6レバー組み合わせ空間」の breakdown は組み合わせ定義が決まってない段階で複雑化すると曖昧になる → Task 8(攻防ループで実 AttackPattern が積まれて空間が見えてから)に送り。

### seeder の運用堅牢性
- `INTEGRATION=1` gate(意図しない Firestore 書き込みを防止)
- per-item try/catch(1件失敗で残り 21 件が止まらない)
- 成功/失敗カウント + 失敗詳細サマリ
- 失敗があれば exit 1(CI でも事故検知)

### Firestore モックの落とし穴
`Firestore` は class なので、テストの `vi.mock` も**クラス形式**で書く必要があった。`vi.fn().mockImplementation(() => obj)` だと矢印関数が constructor 扱いされず `TypeError: ... is not a constructor` で落ちる。初回実行で踏んで class モックに切り替え。

## どう

### 実行フロー
1. 依存追加(`@google-cloud/firestore` runtime, `tsx` dev)を background install
2. ファイル群を並列で書き、`package.json` に `seed:benign` スクリプト追加
3. `tsc --noEmit` → 通過
4. `vitest run` → firestore モック 3件落ちる → class 形式に修正 → 50 passed
5. `INTEGRATION=1 vitest run` → 統合含めて 53 passed(Task 2 / Task 3 統合に回帰なし)

### コメント方針
- `firestore.ts`: `__resetForTests` の意図(Vitest のモジュール状態と整合性を取るための逃げ口)
- `metrics.ts`:
  - `getDetectionThreshold` 冒頭に「空文字→0 罠と out-of-range の事故を遮断」の3重ガード理由
  - `Ratio` 型の上に「null = 分母なし」契約
- `benignSamples.ts` 冒頭に「予測スコアは仮説、目標ではない、バンドに back-fit するな」原則
- `seedBenignSamples.ts` 冒頭に運用前提(`INTEGRATION=1` / 冪等性)
- `firestore.test.ts` のモック上に「class 形式でないと `new` が落ちる」注記

## 確認した完了条件
- [x] `npx tsc --noEmit` エラーゼロ
- [x] `npx vitest run`(単体)50 passed(metrics 23 + firestore 3 + 既存 24)
- [x] `INTEGRATION=1 npx vitest run` 53 passed(Task 2/3 統合回帰なし)
- [x] **手計算と一致** — recall 2/3 / fpr 1/3 / coverage 3/4 全部 exact 等値で通過
- [x] **judge をモックした evaluateSamples** で recall 100% / FPR 0% を確認 + mixed accuracy の 1/2 / 1/2 も確認
- [x] **AttackPattern 配列から coverage 集計** が通過(`detectionResult` 欠落も「未検知」に倒す)
- [x] seeder は INTEGRATION=1 で実行可能な状態(私の手元では実走行しない、ユーザー側で `npm run seed:benign`)

## 重要な申し送り

### Seeder は未走行(ユーザー側で実行)
- 私の手元では `npm run seed:benign` を走らせていない。
- 必要なもの: `GOOGLE_CLOUD_PROJECT=ai-bridging`、`INTEGRATION=1`、ADC(`gcloud auth application-default login`)、Firestore API 有効化、Firestore データベース作成(`(default)`)。
- 実行コマンド: `$env:INTEGRATION="1"; npm run seed:benign`
- 期待出力: `Done. ok=22, fail=0, total=22`
- 走らせたら Firestore コンソール → `benignSamples` コレクション → 22 ドキュメントを確認できる
- 失敗パターン: Firestore 未作成 → 「Database does not exist」 / API 無効 → 403 / 認証無し → UNAUTHENTICATED 

### §5 設計穴の決着済み前提を踏襲
Task 3 で確定:「`intensity:0` / `friction:"high"` が "効いてない" の正式表現」「`incentive.type`・`callToAction.action` に none enum 追加しない」。benign サンプルの想定スコアもこの解釈の上で書いている。

### "FPR=0" 主張の限界(デモ口頭スクリプト用メモ)
- 22 件で誤検知 0 でも 真の FPR の 95% 上側信頼限界 ≈ 13.6%(rule of three)
- 口頭では「22 件の hard negative で誤検知ゼロ」と分数で語る。「FPR ≈ 0%」と言い切らない
- 審査員に振られたら「サンプル数を増やす計画」「決勝までに人手 + 公開コーパスから追加収集」と返す

### Task 6 への申し送り(調査ツール群、§6-3)
- ADK 導入は Task 8 まで保留(攻撃⇄防御の複数エージェント連携が本番)
- Task 6 は `@google/genai` の **function calling** で単一エージェントのツール選択を実装
- `checkUrlReputation` / `checkDomainAge` / `verifySenderAuth` / `matchKnownScams` / `checkOfficialAlerts` の5本
- `matchKnownScams` は Firestore の `scamSamples` / `attackPatterns` を引く想定 — 本タスクの firestore.ts に helper を増設

### Task 8 への申し送り(メトリクス UI、攻防ループ)
- メトリクス UI で表示するときは `Ratio = number | null` の `null` を "—" に倒す
- 「22件中 X件」の分数表記を優先(ratio 単体で出さない)
- coverage breakdown(6レバー組み合わせ空間)はこのフェーズで定義 + 実装
- 攻防ループで AttackPattern が積み上がるので `attackPatterns` コレクションを使い始める
- ADK 導入はこのタスクで(複数エージェント連携 = §6-4 動的ルーティング寄りハイブリッド)

## やらなかったこと(意図的にスコープ外)
- メトリクスの可視化(Task 8)
- 攻防ループ(Task 8)
- 調査ツール群(Task 6)
- メトリクス値の Firestore 保存(履歴保持は Task 8 で判断)
- scam サンプルのシード(Task 6+ で攻撃側が自動供給)
- AttackPattern の Firestore CRUD(Task 6+)
- ADK 導入(Task 8)
- 統合テストの自動化(seeder 手動実行で代替)
- weights 校正(seeder 実走 → 22 件分の judge 実行 → 重み調整、は別タスク)

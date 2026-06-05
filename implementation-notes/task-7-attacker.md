# Task 7 — 攻撃エージェント（狼）

## 7-A: leversSchema 共有化（攻防で schema を一本化した物理担保）

実施日: 2026-06-04

### 何を
- `analyzeStructure.ts` 内にあった `LEVERS_SCHEMA` 定義を `src/agents/shared/leversSchema.ts` に逐語抽出し export。
- `analyzeStructure.ts` は `import { LEVERS_SCHEMA } from "@/agents/shared/leversSchema"` に置換（ローカル定義と `Type` の直接 import を削除）。
- フィールドは一切変更していない（抽出のみ）。

### なぜ
- 攻撃側（Task 7-C: 型生成）と防御側（analyzeStructure: 逆算）が同じ 6 レバー schema を参照する**物理的担保**を作るため。コピーが 2 箇所にあると enum 追加時に攻防がズレ、coverage（§7）の意味が壊れる。共有モジュール 1 本にすれば「攻防は同じ語彙」がファイル構造で保証される。

### 抽出前に確認したガード（指示の3点）
1. **テストが schema の定義場所（ファイルパス）を assert していない** — analyzeStructure.test.ts は `call.responseSchema.required` の中身（6 レバー名）だけを検証。import 元パスには依存しない。
2. **参照同一性（===）で schema を比較/キャッシュしている箇所が無い** — `LEVERS_SCHEMA` の参照は `analyzeStructure.ts` の 1 箇所（`responseSchema: LEVERS_SCHEMA`）のみ。grep 済み。ファイル移動で identity が変わっても壊れる経路が存在しない。
3. **共有後の schema にテキスト自由入力欄が無い** — 全フィールドが categorical（enum）か bounded number（intensity 0–3）。自由テキスト欄ゼロ＝道Bの一次防壁。新ファイル冒頭コメントにこの不変条件を明記。

### 完了確認（この順）
1. `npx tsc --noEmit` → green
2. `npx vitest run src/agents/__tests__/analyzeStructure.test.ts` → 8 passed（リグレッション無し）

### やっていないこと
- attacker.ts の実装（Task 7-C）
- schema の内容変更
- テスト新規追加

---

## 7-B: reconPublicAlerts（fetcher 注入境界、SSRF ゼロ方針）

実施日: 2026-06-04

### 何を
- `src/tools/reconPublicAlerts.ts` を新設。`reconPublicAlerts(fetcher?: AlertFetcher): Promise<ReconResult>`。
- 既定 fetcher は `src/data/officialAlerts.json` をそのまま読む（`checkOfficialAlerts` と同一スナップショット）。`date` 降順（新しい順）に並べ、先頭 5 件を `AlertTrend[]`（id/title/category/date）で返す。
- 返り値: `{ ok: true, trends }` / `{ ok: false, reason }`。空配列・取得失敗時は `ok:false`（`no_alerts` / 例外メッセージ）。
- テスト: 単体3本（新しい順 / cap5 / 空時 ok:false、fetcher モック注入）＋ `INTEGRATION=1` ゲートの実スナップショット smoke 1本（CI 既定 skip）。

### なぜ
- **fetcher 注入境界**: ソート・cap・整形のロジックを純粋に保ち、データ源だけ差し替え可能にする。単体はモック fetcher、INTEGRATION は既定 fetcher（実スナップショット）を走らせる。注入は「ネット経路を開く」ためではなく、テスト容易性のため。
- **SSRF ゼロ**: 実ネットワーク I/O は一切しない。`checkOfficialAlerts` の「ライブ取得なし（antiphishing.jp 404・再現性・SSRF 面ゼロ）」方針をそのまま継承。偵察＝事前スナップショット読込のみ。
- **date 降順ソートの根拠**: JSON はカテゴリ別並びで日付順ではない。ISO 日付（YYYY-MM-DD）は辞書順＝時系列順なので `localeCompare` 降順で「新しい順」が成立。
- **untrusted wrap 責任の所在**: `title` は外部由来テキスト＝データ。reconPublicAlerts 自身はモデル境界を持たないので wrap しない。`<untrusted_input>` ラップは呼び出し側 `generateAttackPattern`（Task 7-C）の責任、とコメントに明記。

### 完了確認
1. `npx tsc --noEmit` → green
2. `npx vitest run src/tools/__tests__/reconPublicAlerts*.ts` → 3 passed / 1 skipped（INTEGRATION 既定 skip）

### やっていないこと
- generateAttackPattern との接続（Task 7-C）
- 実ネットワーク通信・ライブ API 呼び出し

---

## 7-C: attacker.ts（generateAttackPattern + evolve）

実施日: 2026-06-04

### 何を
- `src/types/attackPattern.ts` に `parentId?: string` を追加（`sourceContext` は既存）。
- `src/agents/attacker.ts` を新設：
  - `generateAttackPattern(input?): Promise<AttackPattern>` — Gemini 駆動の第1世代型生成。
  - `evolve(prev, feedback): AttackPattern` — 決定的1ステップ・レバー変異。
  - `DetectionFeedback = { detected; missedBy? }` を export。

### evolve の detected=true 契約（throw）
- `feedback.detected === true` は **throw**。Task 8 のループは「すり抜けた（detected=false）型のみ」を evolve に渡す設計で、detected=true で呼ぶのは**呼び出し側のバグ**。回復可能な状態ではないので黙って変異せず fail loud にする。
- generation+1 / 新 id(uuid) / `parentId: prev.id` をセットし、親の `detectionResult` は削除（進化後の型は未判定だから）。

### missedBy の生産/消費契約（feedback-directed）
- **生産**: defender（Task 8）が「どの調査ツールの死角を通り抜けたか」を `missedBy` に埋める。**消費**: attacker が読んで次の変異方向を決める。接続は Task 8。
- マッピング:
  - `"urlReputation"` → `url_lookalike` トリック追加を優先、飽和なら channel 回転（URL系検知の死角＝媒体/見た目の偽装を強化）。
  - `"senderAuth"` → personalization を優先昇格（ヘッダ認証だけでは追いにくい個人化に寄せる）。
  - missedBy 無し / 未対応値 → 固定ラダーにフォールバック。
- 固定ラダー順（§5 個人化＝核心を最初）: personalization → isolation → urgency → friction → incentive → credibilityTrick。最初に変化を出したものを1つ適用。
- 全レバー上限時は **channel 回転**で no-op を防止（channel は必ず別値が存在）。

### parentId による系統追跡の意図
- evolve が `parentId: prev.id` を刻むことで、デモで1つの型の祖先（gen1→gen2→…）を全鎖を保存せずに辿れる。gen1 root は `parentId` 未設定。

### 道B：二重防壁
1. **一次（schema）**: `ATTACK_SCHEMA = { levers: LEVERS_SCHEMA, channel }` のみ。テキスト自由欄を物理的に持たせない。
2. **二次（再帰ホワイトリスト検証）**: Task 7-D で「出力オブジェクトに messageBody 等のテキスト欄が無いこと」を再帰検証するテストを追加し、schema をすり抜けた万一の混入も塞ぐ。
- 加えて recon の外部テキストは `<untrusted_input>` で wrap（wrap 責任は 7-B の注記通り attacker 側）。fallback seed は `sourceContext: "fallback-seed"` を刻んで degraded を区別。

### 分割判断
- generateAttackPattern（async/Gemini）と evolve（sync/決定的）は同一型を共有する凝集単位のため 1 ファイル 1 パスで実装。ただし evolve の方針は小さな純ヘルパー（escalate*/lowerFriction/addCredibilityTrick/rotateChannel）に分解し、7-D が evolve 経由で個別検証できる構造にした。

### 完了確認
- `npx tsc --noEmit` → green（evolve の detected=true throw を含め型が通ることを確認。本体テストは Task 7-D）。

### やっていないこと
- テスト本体（Task 7-D）
- 防御との接続・ループ駆動（Task 8）
- defender 側の missedBy 埋め込み（Task 8 接続時）

---

## 7-D: テスト一式

実施日: 2026-06-04

### 何を
`src/agents/__tests__/attacker.test.ts`（18 本）を新設。reconPublicAlerts のテストは 7-B に既存のため再追加せず。

- **道B ホワイトリスト再帰検証**: `ALLOWED_SHAPE`（AttackPattern が許す全 key を各深さで列挙）に対し「許可 key 以外が出たら NG」を再帰検証。禁止名リストではなく**許可以外は全部 NG** 方式。検証器自体が `messageBody` 混入を捕まえることも逆テストで担保。
- **schema 自由テキスト欄ゼロ**: 捕捉した `responseSchema` を再帰 walk し、`type===STRING` なのに `enum` を持たないノード（＝自由入力欄）が 0 件であることを assert。トップは levers+channel のみ。
- **決定性**: 同一 `{detected, missedBy}` → `id` を除く構造が同一であることを検証。`id` は `randomUUID`（毎回新規＝別エンティティ）なので比較から除外。これが「変異ロジックの決定性」の定義。
- **evolve**: detected=false→generation+1 かつレバー変化／detected=true→throw／上限シードで channel 回転（no-op 防止）／`missedBy="urlReputation"`→url_lookalike 追加／`missedBy="senderAuth"`→personalization 昇格／親 detectionResult 破棄。
- **generateAttackPattern**: 6 レバー充足・generation===1・sourceContext 有・トレンドから sourceContext 導出・system 命令の道B文言。
- **PI 対策**: recon が nonce `untrusted_input` で wrap され、同 tag を system 命令が参照していることを assert。
- **degraded**: Gemini throw / 不正 JSON / levers 形不足 の各ケースで `sourceContext==="fallback-seed"`。

### 完了確認
1. `npx tsc --noEmit` → green
2. `npx vitest run`（単体）→ 152 passed / 6 skipped（integration 既定 skip・回帰なし）
3. `INTEGRATION=1 npx vitest run src/tools/__tests__/reconPublicAlerts.integration.test.ts` → 1 passed
   （Gemini 系 integration は実 Vertex 認証が必要で本タスク範囲外。Task 7 が追加した INTEGRATION ゲートは recon のみ。）

---

## 完結チェックリスト（5 点）
1. **leversSchema 共有化** — 7-A。`src/agents/shared/leversSchema.ts` に一本化＝背骨（6 レバー語彙）の物理担保。
2. **evolve の detected=true 契約** — 7-C。throw。Task 8 のループは detected=false 時のみ evolve を呼ぶ。
3. **missedBy の生産/消費契約** — 7-C。defender が埋め（生産）、attacker が読む（消費）。接続保証は Task 8。
4. **道B 二重防壁** — schema にテキスト欄なし（一次・7-A/7-C）＋ ホワイトリスト再帰検証（二次・7-D）。
5. **parentId 系統追跡** — 7-C。evolve が `parentId: prev.id` を刻み、全鎖保存なしで祖先を辿れる。

---

## smoke test 実行結果（Task 7-V3）

実施日: 2026-06-04 / スクリプト: `scripts/smoke-attacker.ts`（CI 非対象・`npx tsx scripts/smoke-attacker.ts`）

この環境は Vertex 認証（GOOGLE_CLOUD_PROJECT + ADC）が無いため Gemini 呼び出しが失敗し、gen1 は **fallback-seed に degraded**。ループ構造・evolve・契約は全て想定通り動作。最後の「fallback-seed でない」基準のみ credentialed run が必要（環境要因であり実装の欠陥ではない）。

```
=== Task 7-V3: attacker smoke test ===

--- 1. reconPublicAlerts (default fetcher) ---
  [delivery] 2026-05-30  カンガル運輸の不在通知を装うSMS詐欺事例
  [business_partner] 2026-05-29  取引先を装う振込先変更依頼メールに関する注意喚起
  [financial] 2026-05-28  カンガル銀行を装うフィッシングメールにご注意ください
  [platform] 2026-05-27  ペンギン決済を装うアカウント凍結通知メール
  [government] 2026-05-26  カンガル税務署を装う還付金請求メールに関する注意喚起

--- 2. generateAttackPattern (gen1) ---
  generation:    1
  sourceContext: fallback-seed   ← Vertex 認証なしのため degraded
  channel:       email
  levers: urgency(deadline/1) authority(financial,[formal_tone])
          incentive(fear/account_loss/1) callToAction(click_link/mid)
          personalization(broadcast/[]) isolation(none/0)

--- 3. evolve (detected=false, missedBy=urlReputation) → gen2 ---
  parentId:   <gen1.id と一致>
  generation: 2
  channel:    email

--- 4. gen1 → gen2 changed levers ---
  levers.authority.credibilityTricks: ["formal_tone"] → ["formal_tone","url_lookalike"]

--- 5. evolve (detected=true) must throw ---
  threw as expected: evolve() called with detected=true; only slipped-through patterns (detected=false) may be evolved.

--- 合格基準 ---
  [OK] gen1 の 6レバーが全て埋まっている
  [OK] gen2 の generation が 2
  [OK] gen2.parentId === gen1.id
  [OK] urlReputation で channel か credibilityTrick が変化
  [OK] detected=true で throw
  [NG] sourceContext が "fallback-seed" でない（Gemini 正常時）← 要 credentialed run

RESULT: 5/6 OK（NG は Vertex 認証なしの環境要因）
```

**読み取り**: missedBy=`urlReputation` 誘導が fallback-seed（`credibilityTricks:["formal_tone"]`）に対し `url_lookalike` を正しく追加。parentId 系統追跡・generation+1・detected=true throw も実走行で確認。credentialed 環境では gen1 が `recon:...` になり 6/6 になる見込み。

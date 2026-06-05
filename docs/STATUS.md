# KangaL STATUS — 当初計画 vs 実装の棚卸し

作成: 2026-06-05 / 目的: 計画引き直しの土台。**計画と実態のズレに焦点**。
判定根拠はコード・テスト実走・デプロイログの**現物のみ**。未確認は「未確認」と明記。
テスト基準: `npx vitest run` = **19 files / 181 tests passed, 4 files / 6 tests skipped**（skip は `*.integration.test.ts`、`INTEGRATION=1` ゲート）。

---

## 1. フェーズ別 実装状況

| フェーズ | 判定 | 出来ていること / 残り |
|---|---|---|
| **Phase 0** スパイク+骨格デプロイ | **完了** | ADKスパイク（使い捨て）動作確認済み・コミット済み。Cloud Run ライブ（`kangal`/us-central1/**認証必須**）で paste→Gemini→返答を実機確認。※ADK は spike 限定で、本番ループは手組み（下記§2-2）。 |
| **Phase 1** 防御エージェント | **部分実装（ほぼ完了）** | 型(§5)✅・スコアリング(`weights`/`judge`)✅tested・調査ツール5本✅tested・オーケストレーション anchor+dynamic✅（§3）。**残り: 「単一の正規化入口」が未収束**（§4。正規化モジュール不在）。 |
| **Phase 2A** 物語検証 | **部分実装** | `missedBy→変異`の駆動は実装(`evolve` の directed mutation)+tested。デモで承転結アークを**可視化**できる。**残り: 実エージェント/シードで実際に「山」が出るかは未検証**（デモは scripted、§5）。 |
| **Gmail** 読み取りポーリング | **未着手** | `src` に Gmail 実装なし（`gmail` 一致は `verifySenderAuth` のコメントのみ）。 |
| **Phase 2B** 攻防ループ自律化 | **部分実装** | 攻撃エージェント(`generateAttackPattern`+`evolve`)✅tested、`loop.ts`(生成→調査→判定→進化)✅tested(mock)、missedBy配列→単一の橋渡し✅。**機構は回る。実Gemini自律走での山(物語)は未検証**。ADK未採用（意図的に先送り、§2-2）。 |
| **Phase 3** メトリクス+外部ホールドアウト分離 | **部分実装** | `metrics.ts`(recall/fpr/`recordRound`/閾値)✅tested。**残り①**: `loop` の `judgeSample` 既定が placeholder(`score:0`固定)＝実サンプル採点が未配線→サンプルベースの recall/FPR は今は動かない。**残り②**: 外部ホールドアウトの物理分離は**未確認**（`seedBenignSamples` スクリプトは存在するが分離設計は未読・未検証）。 |
| **Phase 5** 総点検+デモ準備 | **部分実装** | デモUI(`/demo`＋5コンポーネント)+倫理ディスクレーマ＋scripted シナリオは完成。総点検は未（＝本STATUSがその一歩）。 |

---

## 2. 当初計画との主要な差分

| # | 差分 | 推奨 |
|---|---|---|
| 1 | **調査ツール 3本→実装は5本**（`domainAge`/`officialAlerts` 追加。本体+配線+テスト済み、30ファイル規模で利用） | **実装が正**。計画を5本に更新。絞るのは動作・テスト済みコードの後退になるため不可（既存が要件どおりなら壊さない）。判断記録: `docs/implementation-notes-types.md`。 |
| 2 | **ADK で自律化→実態は手組みループ**（`loop.ts` は `@google/genai` 直叩きの for-loop。ADK は spike のみ） | **実装が正（現状）**。`loop.ts` のコメントどおり、唯一の動的判断(ツール選択)は既に `investigate.ts` の function-calling にあり、for-loop に framework を足す利得が無い。計画を「ADK 形を保った手組み（将来 swap 可）」に更新。 |
| 3 | **単一の正規化入口に収束→未収束**（paste/loop/demo が別経路、§4。正規化モジュール不在） | **計画が部分的に正だが今は破壊不要**。収束相手の Gmail が未着手で、paste(message-body)とloop(levers)は入力の性質が別。**Gmail 実装時に paste と共通の message 正規化を作る**のが素直。 |
| 4 | **デモループ=実 runLoop の想定→実態は scripted `DEMO_ROUNDS`**（ハードコードで承転結を決定論再現） | **未検証項目**（実装が正でも計画が正でもない）。可視化の保険としては正しい設計だが、Phase 2A の本来目的「山が実際に出るか」は別途**実走で検証**が必要。`_loop.ts` のデータ源を実 `runLoop` 結果へ差し替える前提で組まれている。 |
| 5 | **メトリクスのサンプル採点が placeholder**（`judgeSample` 既定 `score:0`） | **計画が正（実装を進める）**。message-body 判定パスを `judgeSample` に配線しないと外部ホールドアウト/良性サンプルでの recall・FPR が動かない。Phase 3 の核。 |

---

## 3. オーケストレーションの実体（`src/agents/investigate.ts`）

- **anchor**: `matchKnownScams` を **調査フェーズ開始直後に必ず1回**。強制は description ではなく**システム命令**に記述（「最初に必ず1回だけ呼ぶ。引数不要」）。レバーはオーケストレータのクロージャから渡す（Gemini は引数を渡さない）。
- **dynamic（残り4本）**: `checkUrlReputation` / `checkDomainAge` / `verifySenderAuth` / `checkOfficialAlerts` を各 `description` の呼び出し条件で Gemini が選択。事前フィルタはせず、誤呼び出しは各 executor 側でガード（例: auth ヘッダ無しの `verifySenderAuth` は no-op 入力）。
- **配線**: 5本すべて executor 実装済み・finding へマッピング済み。`maxTurns=6`(=宣言5本+サマリ1)、全体予算 `25s`(超過で abort→`truncatedReason:"budget"`)。
- 結論: **anchor は matchKnownScams 1回固定＋dynamic 4本**、という §6-4 の設計どおりに実装されている。

---

## 4. 入力経路（**単一の正規化入口は無い**）

| 経路 | 入口 | パイプライン | 状態 |
|---|---|---|---|
| 貼り付け | `InboxApp` → `fetch("/api/judge")` | `analyzeStructure`(構造分解) → `investigate` → `judge` | ✅動作（本番実機確認済み） |
| 攻防ループ | `runLoop`（要 `DEMO_MODE`） | `investigate({message:"", levers})` → `judge`（**本文なしでレバーのみ**＝道B） | ✅機構（mockテスト緑）。実走の山は未検証 |
| デモ | `runDemoRound` → `buildDemoRound` | **scripted `DEMO_ROUNDS`**（実パイプライン不通過） | ✅可視化。実データ非接続 |

- **正規化モジュールは存在しない**（`src/lib/normalize*`/`input*` 無し）。
- `/demo` 配下は `proxy.ts`(Next16 の旧 middleware)が `DEMO_MODE!=="true"` で **403**＝本番ではデモ遮断（多層防御で `assertDemoMode()` も併用）。
- **Gmail は未着手**（読み取りポーリング実装なし）。

---

## 5. 攻防ループの現在地

- **攻撃エージェント** `attacker.ts`: `generateAttackPattern`（recon→Gem?ini で6レバー生成、失敗時 `fallback-seed`）✅、`evolve`（決定論1ステップ変異。`missedBy` で `urlReputation`/`senderAuth` 方向に誘導、それ以外は固定ラダー。`detected=true` は throw）✅。道B遵守（スキーマはレバー+channelのみ、自由文不可）。
- **`loop.ts`**: 生成→調査→判定→進化の手組み。`detectionResult.missedBy`(ToolName[]) を `[0]` で単一に橋渡しして `evolve` へ（**配列→単一の橋渡し実装済み**）。`DEMO_MODE` ゲート。
- **「回る」**: ✅ `loop.test.ts`/`attacker.test.ts` 緑（mock 注入の単体）。
- **「山(検知率の上昇アーク)が出る」**: ❌ **未検証**。デモの山は scripted `DEMO_ROUNDS` で、実エージェントの自律走で創発した記録は無い。`scripts/smoke-attacker.ts` は recon→gen1→evolve→gen2 の**1変異のみ**・要 Vertex 認証・結果は未記録。

---

## 6. 既知の未解決・ブロッカー

| 項目 | 影響範囲 | メモ |
|---|---|---|
| **Firestore `datastore.user` 未付与** | **anchor が本番で常時 degrade**。`matchKnownScams`→`listAttackPatterns`(firestore)が本番で `7 PERMISSION_DENIED`（デプロイ実機で確認）。毎回呼ぶ anchor が死ぬと防御パイプライン全体の挙動確認が濁る。 | 02-3 着手前に実行SAへ `roles/datastore.user` 付与＋Firestore有効化（コマンドは `implementation-notes-deploy.md`）。ローカルtestはfirestoreをmockしているため緑。 |
| **Web Risk 未配線** | `urlReputation` が本番で常時 `missing_api_key`。URL評価が効かない。 | 骨格スコープで意図的に未配線。Secret Manager 経由の投入手順は `implementation-notes-deploy.md`。 |
| **`judgeSample` placeholder** | サンプルベースの recall/FPR が今は動かない（`score:0`固定）。 | Phase 3 で message-body 判定パスを配線。 |
| **外部ホールドアウト物理分離** | recall の自家中毒回避（計画の核） | **未確認**。`seedBenignSamples` は存在するが分離設計は未読。 |
| **本番 RDAP 成否（実ドメイン）** | `domainAge` | **未確認**。デプロイ確認では `.test` ドメインで `http_403`（RDAP非対応TLD、想定どおり）。実ドメインでの本番取得可否は未テスト。 |
| DEMO_MODE 本番未設定 | 攻撃/デモ機能を無効化（意図どおり） | blocker ではないが運用注意。本番 env に DEMO_MODE を足さない。 |

---

## 7. テストの実在

- **緑（決定論部・契約部）**: `weights`(スコアリング)、`metrics`(recall/FPR/閾値)、調査ツール6本すべて(unit)、`matchKnownScams`、`judge`(unit)、`analyzeStructure`(unit)、`loop`、`attacker`、`demo`(`_loop`変換)、`gemini`、`untrustedInput`、`demoMode`、`firestore`(mock)、`api/judge` route。
- **skip（4 files / 6 tests）**: `analyzeStructure` / `investigate` / `judge` / `reconPublicAlerts` の `*.integration.test.ts`。`INTEGRATION=1` ＋実 Vertex/実ネット必要。CI では走らない＝**実 Gemini 経路の自動回帰は未稼働**。
- **テスト無し**: `sampleMessages.ts`、UIコンポーネント（`InboxApp.tsx`、`demo/_components/*.tsx`。`demo.test.ts` は純ロジック `_loop` のみ）、`proxy.ts`(ルートゲート)。＝**UIレンダリングとルートゲートは自動テスト外**。

---

## 一言サマリ（計画引き直しの起点）

決定論部（型・スコアリング・5ツール・anchor+dynamic・メトリクス算出）は**実装もテストも厚い**。
ズレの本丸は3つ: **(a) 物語(山)が実エージェントで出ることが未実証**（デモは scripted）、**(b) 本番で anchor が Firestore 権限で degrade**、**(c) Gmail と単一正規化入口が未着手**。
Phase 2B/2A の価値（自律で山が出る）を**実走で1回示す**ことが、いま最も計画の不確実性が高い。

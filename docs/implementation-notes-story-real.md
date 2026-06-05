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

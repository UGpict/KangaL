# thinkingBudget スイープ — レイテンシ削減の試みと不合格（2026-06-13）

位置づけ: 提出前（6月末フリーズ前）の **1回きりのスコア変更バッチ**。`gemini.ts` の
`thinkingConfig` 継ぎ目だけを触り（judge ロジック・computeScore・閾値70は不変）、
レイテンシ（~48s/単発）を削れるかを事前合否基準つきで検証した。

## 結論（先に）

**不合格 → `thinkingConfig` は revert（設定しない＝unbounded のまま、48s を受け入れる）。**
Web Risk 実働化は本バッチと独立に残す（合否対象外）。再々測はしない（事前にそう決めた）。

レイテンシ対策は別レイヤ（`調査中カード` の UX ＋ ProtoPedia への所要時間明記、G3.1 で実装済み）
に委ねる。速度が取れなくても提出物は成立する、の方針どおり。

## 何を測ったか

`gemini-2.5-flash` は thinking がデフォルト ON（unbounded）で単発 ~48s。これを
`thinkingConfig.thinkingBudget` で絞ればレイテンシが落ちる。ただし thinking は知覚
（`analyzeStructure` のレバー素点）の質に効きうるので、**holdout recall を割らないか**を
事前基準で判定する設計にした。

事前合否基準（測定後に動かさない）:
- 合格 = holdout recall 現状維持以上 AND レッドチーム4/4維持 AND effective FPR 悪化なし。
- 不合格時の手順 = `budget=512` で1回だけ再測 → それでも不合格なら **revert**。

測定は `evalRealHoldout.ts --freeze-investigation`（K-run）で、investigate を実物 report で
1回凍結 → judge を K 回。非決定を `analyzeStructure`（知覚）に絞り、保存スコア行列を床 grid に
事後 re-threshold（LLM コール追加ゼロ）。

> 測定足場の但し書き: スロー Vertex 日に seed の investigate が budget-exceeded / 429 で
> truncate し、合否の数字に Vertex スロットリングが混入した。`evalRealHoldout.ts` の K-run
> seed に **一時的な** `SEED_BUDGET_MS` / `SEED_MAX_RETRY` の knob を入れ、seed が
> untruncated な report で凍結するまでリトライしてから本測定した（全6サンプルをクリーン比較）。
> この knob は「2継ぎ目だけ」を守るためコミット前に unstage する測定足場。

## 結果

### budget=0（K=10, クリーン）

baseline §7.2（K=10）と比べ全サンプルで系統的に 10–25pt 下落。床70 recall 1/6 → **0/6**、
床60 4/6 → **0/6**。決定性（spread）は改善したが center が下がった＝thinking 除去は
レバー知覚の質を実際に下げた。→ 事前基準の不合格パス発動（512 へ）。

### budget=512（K=10, クリーン再測）

| 床 | 512 recall | baseline §7.2(K=10) recall | 512 FPR[easy] |
|---|---|---|---|
| 70 | **0/6** [0–39%] | 1/6 | 0/3 |
| 65 | 0/6 | 3/6 | 0/3 |
| 62 | 0/6 | 3/6 | 0/3 |
| 60 | **0/6** [0–39%] | **4/6** [30–90%] | 0/3 |
| 58 | 2/6 | 4/6 | 0/3 |
| 55 | 2/6 | 4/6 | 0/3 |

per-sample 最大スコア（10ドロー）: amazon 68 / nenkin 65 / etax-shotokuzei 59 / smbc 57 /
rakuten 53 / apple 47 — **どれも一度も70に届かない**。baseline では nenkin が70到達し床70の
1/6 を駆動していた。床60 の 4サンプル差は frozen-draw 分散（§6 2/6 vs §7.2 1/6 の幅）では
説明できない。加えて nenkin・etax・benign nozeishomeisho に score=0 の degraded ドロー
（`analyzeStructure` parse 落ち）が散発＝512 は知覚 degrade も起こす（baseline には無い挙動）。

→ recall維持を満たさず **不合格**。512 も baseline を回復しない。

## レバー差分 probe（失敗測定からの知見回収）

不合格でも「thinking はどのレバー知覚に効くか」を回収するため、nenkin 1サンプルで
`thinkingBudget` を振って `analyzeStructure` 相当の生レバー出力を比較した
（`scripts/probeNenkinLeverDiff.ts`・観測専用・unstaged）。3ドロー/条件:

| レバー | unbounded(baseline) | budget=0 | budget=512 |
|---|---|---|---|
| urgency | **3** | 3 | 3 |
| authority | government, [formal_tone, ref_number, **logo_mimicry**] | government, [formal_tone, ref_number] | government, [formal_tone, ref_number] |
| incentive | **3** | 3 | 3 |
| callToAction | transfer_money/low | transfer_money/low | transfer_money/low |
| **personalization** | **targeted, signals=[transaction_history]**（全3） | broadcast/segmented, **[]** | broadcast×2/targeted, **[]** |
| isolation | 0,0,2 | 0 | 0 |

**読み:** 高 intensity の骨格（urgency3・authority=government・incentive3・cta=transfer/low）は
全条件で頑健。thinking を絞ると失われるのは**細粒度の知覚2つ**:
1. **personalization の精読**: `targeted + signals=[transaction_history]` → `broadcast + []` に劣化。
   これは KangaL の **BEC 差別化レバーそのもの**。線形和の personalization 寄与が落ちる＝
   系統的 ~10pt 下落の主因。
2. authority の **logo_mimicry トリック脱落**。ただし authority strength は
   `min(3, 1+tricks.length)` で 2トリックでも3に張り付くため**スコア中立**（知覚としては
   劣化しているがスコアには出ない）。

結論: **thinking が買っていたのは「速度のロス」ではなく、KangaL が誇る差別化レバー
（personalization の精読）の知覚精度だった。** あの48秒の一部は確かに知覚を買っていた。

## G4 申し送り

- Web Risk 実働化（`WEB_RISK_API_KEY`）は本バッチと独立に有効化済み（`.env.local`、加点のみ）。
  本番は **Secret Manager 経由**で実行 SA に渡す（GMAIL_SESSION_KEY と同方針／鍵をイメージや
  リポジトリに置かない）。urlReputation の実レスポンス疎通は確認済み
  （benign→threats:[] / SOCIAL_ENGINEERING を実検出）。
- レイテンシは未解決の将来課題。床の最終決定（intensity 下限 / BEC 構造床）と FPR 本番
  ストレッサー（商用良性）は引き続き人間ゲート保留（[[security-redteam-h1]] と同方針）。

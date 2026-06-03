# Task 1 — 中核型 AttackPattern（背骨）

実施日: 2026-06-03

## 何を
- `src/types/attackPattern.ts` に `AttackPattern` 型（6レバー + channel + generation + sourceContext + detectionResult）を設計 §5 から一字一句で書き起こし。
- 同ファイルに `ScamSample` / `BenignSample` / `Sample` を discriminated union で定義。`kind` が判別子と ground truth ラベル兼用。
- `src/types/__fixtures__/attackPattern.example.ts` に6レバー全てを埋めた `AttackPattern` 1件と、`ScamSample` / `BenignSample` 各1件のフィクスチャを置いた。
- `npx tsc --noEmit` で型エラーゼロを確認。`--listFiles` でフィクスチャも検算対象に入っていることを確認。

## なぜ
- **AttackPattern は背骨**: §5 の3役割（攻撃が書く / 防御が読む / 危険度スコアの素）を支える型。enum 値・キー名を勝手に変えると以降のすべて（エージェント、ツール、メトリクス、UI コピー）が drift する → 一字一句で写すことが安全側。
- **ScamSample / BenignSample に AttackPattern を結びつけない**:
  - 道Bが禁じるのは「型から合成した出自を保存すること」(`craftedFrom: AttackPattern` 等)。それは「そのまま送れる詐欺文の量産庫」になる。
  - 一方 `ScamSample.messageBody` は **収集済み実例 or 手書きの「答案用紙」** で、攻撃AIに生成させる枠ではない。性質が別物。
  - 評価は2系統に分かれる（recall/FPR は静的サンプルで測る、coverage は AttackPattern.detectionResult を集計するだけ）。サンプルに pattern を結ぶ必要はそもそも無い。
- **discriminated union (C案)**:
  - `kind` は型判別子と評価時の正解ラベルの両役を兼ねる（§7 recall/FPR の "正解"）。
  - 将来 `unverified` / `false_positive` 等のラベルを足したいときに `kind` を拡張するだけで、switch の網羅性チェックが漏れを型エラーで検出する。
  - boolean フラグ（B案）だと2値で固定されて拡張で破綻。`label` 文字列共通（A案）だと判別子と分類ラベルが意味的に混ざる。
- **`observedLevers?: AttackPattern["levers"]` は今回入れない**:
  - 「実例を観測して後から分類した」注釈は道Bセーフだが、MVPでは要らない。必要になったタイミングで追加すれば trivial。
- **テストランナー非導入**:
  - Task 1 は型定義のみ。`tsc --noEmit` が唯一の検算で十分。
  - ロジックが入る Task 2 以降で軽量ランナー（Vitest 等）の導入を判断する。

## どう
1. **設計 §5 を `docs/design-v0.1.md` の 99〜139 行目から直接コピー**して TypeScript として整形。改行の入れ方は prettier 流（union を `|` で縦並び）に揃えたが、識別子と値はすべて §5 通り。
2. **コメント方針**: CLAUDE.md「Default to writing no comments」を尊重。残したのは2つだけ。
   - 道B invariant（craftedText 等を足すなの不変条件） — 将来の自分への番犬
   - `kind` の二重役（判別子＋ground truth）の意図 — switch 網羅性の伏線
3. **フィクスチャは `__fixtures__/` サブディレクトリ**に隔離。Jest 慣習でテストランナー導入後に違和感無く活きる。
4. **架空コンテキストのみ**: `sourceContext: "fictional/archetype/ceo-fraud"`、`missedBy: "v0-defense"`。実在企業名・機関名は一切使わず（CLAUDE.md セキュリティ規約）。
5. **`messageBody` は placeholder 文言**: フィクスチャは型検算が目的で、実サンプルは §13 未決の良性サンプル調達フェーズで埋める。

## 確認した完了条件
- [x] `npx tsc --noEmit` がエラーゼロで通る（strict mode 有効、`tsconfig.json` line 7）
- [x] 6レバー全てを使ったダミー `AttackPattern` が型エラーなく書ける（`exampleAttackPattern`）
- [x] `--listFiles` で `attackPattern.ts` と `attackPattern.example.ts` の両方が検算対象に入ることを確認

## やらなかったこと（意図的にスコープ外）
- ロジック・関数・コンストラクタ・バリデーション（zod 等）
- ScamSample / BenignSample の `id` フィールド（指示「メッセージ本文＋期待ラベルのみ」に厳密に従う）
- `observedLevers?` フィールド（道Bセーフだが MVP に不要）
- AttackPattern の危険度スコア計算（§5 で「各レバーの intensity × 重み」と書かれてるが重み係数は §13 未決）
- テストランナー導入
- 詐欺判定ロジック・UI・API・Firestore 連携

## 次タスクへの申し送り
- Task 2 でロジックが入る場合は軽量テストランナー（Vitest 推奨：TS ネイティブ、Next.js 15 と相性良し）の導入を判断する。
- `observedLevers?` を足したくなったら `AttackPattern["levers"]` 参照で `Partial<...>` 化が綺麗（実例を観測した範囲だけ埋められる）。
- `kind` 拡張時は防御側の判定結果型と samples の集計関数の switch を必ず触る前提で。型が漏れを教えてくれる設計。
- スコア重み（§13 未決）を決めるとき、`intensity` を持つレバー（urgency / incentive / isolation）と持たないレバー（authority / callToAction / personalization）で重みの当て方の単位が違う点に注意。

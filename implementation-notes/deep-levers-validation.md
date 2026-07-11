# レバー構造の深い検証（レビュー指摘A-1: fail-open 封鎖＋道B実行時担保）

## 課題

`isLeversShape` が `analyzeStructure.ts` と `attacker.ts` に同一実装で重複し、どちらも「6キーが非 null オブジェクトであること」しか見ていなかった。調査で判明した実害は指摘より深い:

1. **NaN fail-open**: `{"urgency":{"intensity":"very high"},...}` が通過 → `strengthOf`（weights.ts）が NaN を生成 → `computeScore` NaN → `NaN >= 70` は false → **不正応答が静かに「安全バンド」で返る**。`ISOLATION_FLOORS[undefined]` も同経路。NaN は `leverVector.encodeLevers` にも伝播
2. **道Bの穴**: attacker.test.ts の ALLOWED_SHAPE 再帰検査は**テストフィクスチャ専用**で、本番の `generateAttackPattern` は `obj.levers` を素通し採用していた。Gemini 応答に `urgency.craftedText: "至急振込"` のような自由文キーが紛れても排除する実行時機構がなく、Firestore まで到達し得た
3. Gemini responseSchema は enum/required には強いが **INTEGER の minimum/maximum は保証が弱い** → 0-3 範囲チェックは実行時に必要

## 設計

### `shared/leversSchema.ts` — enum 正本の一元化（ワイヤ同値リファクタ）

enum 10配列（`URGENCY_TACTICS` 等）を export し、`LEVERS_SCHEMA` をそれらから再構築。配列定義には `exhaustiveEnum` ヘルパー（arrayOfAll パターン）を使用:

- 方向1（配列に型外の値）: `readonly Union[]` 制約が型エラー
- 方向2（TS union に追加したのに配列未更新 — バリデータが正当な出力を誤拒否する方向）: 条件型の交差が型エラー

`satisfies` 単独では方向1しか捕まえられないため採用。スポットチェック実施済み（union に仮メンバー追加→`TS2322`、配列に typo→`TS2820 Did you mean '"none"'?`、両方 revert 済み）。schema 側は `enum: [...ARRAY]` で展開し readonly tuple を素の string[] に落とす。

### `shared/validateLevers.ts` — テーブル駆動の深い検証（新規）

`enumOf` / `intensity` / `arrayOf` の3述語＋`LEVER_SPEC` テーブルを1つのウォーカーが走査。

- **未知キー拒否**（トップレベル・レバー内とも厳密キー一致）: 自由文密輸ベクトルの遮断（道B）。responseSchema 下の Gemini が余剰キーを出す正当理由はなく誤劣化コスト≈0。テーブルから無料で出る
- **intensity**: `typeof === "number" && Number.isInteger && 0<=x<=3`（NaN・小数・文字列・範囲外を全拒否）
- **配列の重複拒否**: 重複 `credibilityTricks` は `Math.min(3, 1 + length)` で authority 強度を静かに水増しするため。`evolve` も両配列を set 的に扱う
- バリデータは `@google/genai` 非依存（schema モジュールから enum 配列のみ import）

### 差し替え

両 agent のローカルガードを削除し共有版を import。**失敗時挙動は不変**: analyzeStructure → `degraded:true`+`NEUTRAL_LEVERS`、attacker → `fallbackSeed`。両者の劣化時レバー値が深い検証にも合格することをテストで固定（空配列受理のケース）。

## テスト（TDD、赤→緑確認済み）

1. `shared/__tests__/validateLevers.test.ts`（20件）: 受理3クラス（VALID／intensity 境界 0・3／空配列=劣化経路の退行防止）＋拒否12クラス（非オブジェクト／キー欠落／余剰キー（トップ・ネスト）／null レバー／フィールド欠落／enum 外／intensity `4`・`-1`・`1.5`・`"2"`・`"very high"`・`NaN`／非配列／enum 外要素／重複要素／signals 側の enum 外）
2. 境界統合4件（**現行シャローガードで4件とも赤になることを確認してから差し替え**）:
   - analyzeStructure: `intensity="very high"` → degraded、enum 外 tactic → degraded
   - attacker: `intensity=5` → fallback-seed、`craftedText` 密輸 → fallback-seed（ALLOWED_SHAPE をテスト演劇から実行時挙動へ転換）

## 検証ログ

- `npm test`: **432 passed** / 6 skipped（前回 408 → +24 = 単体20＋統合4）
- `npm run typecheck`: エラーなし
- `npm run lint`: 0 errors / 7 warnings（すべて既存）
- ドリフト防止スポットチェック: 両方向とも型エラーで捕捉（上記、revert 済み）

## スコープ外（記録）

- `firestore.ts` `listAttackPatterns` の blind cast — 設計コメントで信頼境界として明示受容済み。不変
- `evolve` のハードコード配列（signals/tricks）の enum import 化 — 型付きなのでドリフトは現状でもコンパイル捕捉。後続候補

## コミット運用メモ

`analyzeStructure.ts` に未コミットの temperature フック差分が既存のため、ガード置換ハンクのみをパッチ化して `git apply --cached --recount` で選択ステージした（temperature フックは未コミットのまま維持）。

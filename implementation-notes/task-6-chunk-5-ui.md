# Task 6 — Chunk 5: UI(Verdict カードに調査結果)

## 何を
- `src/components/InboxApp.tsx` 拡張:
  - `InvestigationSection` コンポーネント追加(各ツール 1 行サマリ)
  - `VerdictCard` の末尾に `InvestigationSection` をマウント
  - 受信箱 API call で `authenticationResults` も送るように変更(verifySenderAuth が機能する経路を確立)
- 結果: typecheck green / `npm test` 114 passed(回帰なし)/ `npm run build` 成功(Next.js 16.2.7 Turbopack)

## デザイン規約(Chunk 5 spec 準拠)

- **state 色を使わない**: 調査結果セクションは中立 zinc 系のみ。`bg-zinc-50` / `border-zinc-200` / `text-zinc-500`-`700` の範囲で統一。state 色(red=高 / amber=中 / emerald=低 / slate=判定保留)はバッジと注記ボックスに限定し、調査結果に流れ込まないことで「1色1意味」を保つ。
- **各ツール 1 行サマリ**(spec 通り):
  - 🌐 Web Risk: `MALWARE を検出` / `脅威なし` / `判定不可 (reason)`
  - 📅 ドメイン年齢: `登録から 3 日 (kangaru-shoji.example)`
  - 📧 認証: `SPF=fail DKIM=fail DMARC=fail`
  - 🔍 既知手口: `2 件の類似手口` / `該当なし`
  - 📢 公的注意喚起: `1 件の注意喚起` / `該当なし`
- **bonus 内訳をそのまま使う**: `result.investigationBonus.items` の各 source → points を Map で引いて、対応する行末に `+15` のように表示。`bonus.capped === true` のときヘッダに「上限到達」表示。

## 堅牢性(spec「欠損データ・長文に耐える」準拠)
- **finding 欠落**(ツール非呼出): 行を出さない(undefined チェック)
- **`status: "error"`**: `判定不可 (errorMessage)` 形式で表示。中立カラーのまま赤くしない(誤りが「危険」と誤読されないため)
- **空 matches**(known scams / official alerts): `該当なし` 表記
- **長文/長ドメイン**: `flex-wrap items-baseline` + `break-words` + `min-w-0 flex-1` で折り返し対応。pixel 単位の長さに依存しない
- **`investigation === null / undefined`**: 「調査未実施」のラベルを zinc で出す(degraded 短絡時は VerdictCard の degraded 分岐側で吸収されるので、ここに来るのは API 仕様変更等のレアケース)
- **`truncated === true`**: 末尾に `※ 調査が時間切れで一部のみ完了しました` を zinc で注記

## 統合面
- リクエストに `authenticationResults: message.authenticationResults` を追加。`sampleMessages.ts` で msg-001/002 が `spf=pass dkim=pass dmarc=pass`、msg-003(BEC)が `spf=fail dkim=fail dmarc=fail`。これで verifySenderAuth が **実機 routing で実際に呼ばれる導線**が完成。
- レスポンス側の型 `JudgeResponseBody` は Chunk 4 で `investigation: InvestigationReport` と `investigationBonus: InvestigationBonus` を持つよう拡張済み。InboxApp はその型を route.ts から直接 import しているので、コンパイル時に常に整合。

## 確認した完了条件
- [x] `npm run typecheck` エラーゼロ
- [x] `npm test` 114 passed(回帰なし)
- [x] `npm run build` 成功(Next.js 16.2.7 Turbopack、`/api/judge` が ƒ Dynamic、`/` が ○ Static)
- [x] state 色を調査結果セクションで使わない(zinc のみ)
- [x] 各ツール 1 行サマリ(5 ツール分)
- [x] bonus 内訳が表示される(行末 `+N` と total/capped)
- [x] 欠損データ(undefined / error / 空 matches)で崩れない
- [x] truncated 注記

## やらなかったこと
- メトリクス可視化 / グラフ UI(Task 8)
- 攻撃側エージェント
- ADK 導入
- E2E / Playwright 自動化(`npm run build` でビルド健全性のみ確認)
- 視覚確認(ユーザー側で `npm run dev` → BEC クリックで実際の見え方を確認推奨)

## 視覚確認 — ユーザーへのお願い
CLAUDE.md「UI 変更は dev server + ブラウザで確認」の視覚部分は私の手元では見えません。お手元で以下を確認お願いします。

1. `npm run dev` → `http://localhost:3000`
2. BEC(msg-003)クリック → 判定カードに「調査結果」セクション表示
   - 🌐 / 📅 / 📧 / 🔍 / 📢 のいずれかが Gemini ルーティングで実際に表示される
   - 各行末に `+N` 加点(該当があれば)
   - ヘッダに total と上限到達マーク(該当があれば)
3. msg-001 / msg-002 クリック → benign 系で「該当なし」「脅威なし」中心の中立表示
4. ダークモードでも zinc コントラストが保たれているか
5. emoji が崩れず一行に収まるか(過剰スクロールが出ないか)

違和感(色が読みづらい、レイアウト崩れ、emoji が他用途のアイコンと混乱、等)あれば指摘ください。

# Task 6 — Fix: checkOfficialAlerts を静的スナップショット化 + 全体 budget 25s

実施日: 2026-06-04

## 何を
- `src/data/officialAlerts.json` 新設: 架空名のみの「協議会形式」アラート **26 件**(6 カテゴリ全部カバー: financial 6 / government 4 / business_partner 4 / executive 3 / delivery 5 / platform 4)
- `src/tools/checkOfficialAlerts.ts` を全面書き換え:
  - fetch / RSS パース / cache / timeout を削除
  - JSON を import し、`title.includes(keyword)` で照合
  - `link` は `snapshot://officialAlerts/{id}` の合成スキーム
  - `MAX_MATCHES = 5` の上限維持
- `src/tools/__tests__/checkOfficialAlerts.test.ts` を書き換え:
  - fetch モック撤廃
  - BEC 経路(「取引先」キーワード)が確実にヒットする検証を追加
  - 5 件 cap / OR セマンティクス / 空キーワード分岐
- `src/agents/investigate.ts`: `DEFAULT_BUDGET_MS` を **15s → 25s**(Plan D 後半)
- 結果: typecheck green / `npm test` 115 passed(+1)/ `npm run build` 成功 / **`investigate.integration` が 8.65s で完走**(以前は時間切れ)

## なぜ

### 静的スナップショット方式に切り替えた理由
1. **antiphishing.jp の RSS URL が 404**: 推測した `index.rdf` が存在しない。実 URL を維持し続けるのは demo 用途には脆い。
2. **デモの決定論性**: 毎回同じ挙動。ネットワーク不通 / レート制限 / 仕様変更で詰まらない。
3. **SSRF 面ゼロ**: 外向け fetch が消えるので、SSRF / DNS / 証明書系の心配が文字通り無くなる。
4. **per-tool timeout / cache が不要**: 0ms 同期で returns。コードが半分以下になる。
5. **CLAUDE.md「実在名禁止」と整合**: 実 RSS から取った場合は実在金融機関名が混ざるので、本来も再加工が必要だった。最初から架空名のみで書ける方が筋がいい。

### 全体 budget を 25s に上げた理由
レビュー時の妥当性検算:
- gemini-2.5-flash の 1 ターン RTT: 2-5s(プロンプト長と tool 数に依存)
- 投資ループの典型は 4-5 ターン(初期 routing → 結果 → 追加 routing / 最終要約)
- 4 ツール並列 + 最終要約で 15-22s が現実値

15s だと「届かない」が確率的に起きる。25s に上げると余裕 5s 確保しつつ Cloud Run のリクエスト推奨上限 30s 以内。

### ユーザーが見た事象の根本原因
ユーザー側の demo 画面で次のように出ていた:
```
📧 認証: SPF=fail DKIM=fail DMARC=fail (+8)
🔍 既知手口: 該当なし
📢 公的注意喚起: 判定不可 (http_404)
※ 調査が時間切れで一部のみ完了しました
```

3 ツールが返って finding が乗っていたのは、それぞれ即時 / 即時 / 即 404 で完走したから。truncated の正体は **Gemini の最終要約ターンが 15s budget に間に合わなかった**(または `checkOfficialAlerts` の 404 を見て別キーワードでもう一度試した結果、maxTurns を消費した)パターン。

今回の修正で:
- 404 は完全消滅(JSON 同期返却、エラー経路が無くなる)
- budget 25s で最終要約ターンに余裕

実機 8.65s 完走の数字が示すとおり、両方の効果が乗っている。

## どう

### snapshot の更新方法
将来「協議会の最新傾向に合わせて更新したい」となった時:
1. `src/data/officialAlerts.json` を編集
2. `snapshotDate` を更新
3. typecheck / test がそのまま通る

`source` フィールドに `"fictional — synthetic dataset"` と明示しているので、本物の協議会と取り違える事故も防げる。

### 検査面で残るもの
- substring match という単純照合は変わらず。「取引先を装う」というタイトルに対して keyword=「取引先」で hit する設計を維持。
- Gemini は description を読んで `keywords: string[]` を組み立てる動的ルーティング側の挙動は不変。

## 確認した完了条件
- [x] `npm run typecheck` エラーゼロ
- [x] `npm test` 115 passed(+1、回帰なし)
- [x] `npm run build` 成功
- [x] `INTEGRATION=1` で投資統合テストが **8.65s** で green(以前は時間切れ)

## やらなかったこと(将来の余地)
- 実 antiphishing.jp の正規 RSS エンドポイント特定(運用が安定してから検討。当面は静的 snapshot で問題なし)
- カテゴリベース照合(現状は title substring。`category` フィールドは将来用に残してある)
- snapshot の自動更新 cron(MVP では手動更新で十分)
- ベクトル類似度(keyword match で取りこぼした類似タイトルを拾う。Task 8 以降の宿題)

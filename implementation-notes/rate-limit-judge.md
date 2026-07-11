# /api/judge アプリ層レート制限（コスト防御・レビュー指摘A-2）

## 課題

`POST /api/judge` は無認証・識別子ゼロの公開エンドポイントで、1リクエストあたり Gemini 約3呼び出し＋調査ツール最大5種（15–25秒/件）を起動する。G4 で静的天井（Cloud Run `--max-instances=2 --concurrency=8 --timeout=180`）と予算アラート（¥4500）は実施済みだが、**アプリ層のレート制限が無く、デモ窓開放中は天井いっぱいまでコストが燃え続ける**穴が残っていた。「貼り付けて試す」入口（f81f4d7）の公開で露出が増えたため、決勝前の審査員動線開放に先立って塞いだ。

## 設計

### `src/lib/rateLimit.ts` — 依存ゼロ・インメモリ固定窓・2層

| 層 | キー | 上限 | 根拠 |
|---|---|---|---|
| per-client | クライアントIP | 6/分 | 1判定15–25秒 → 人間は物理的に≤4/分。6でリトライ余地 |
| per-instance global | （単一） | 20/分 | インスタンス飽和 ≈19–32完了/分（concurrency 8 × 15–25s）の直下で支出を拘束。全体最悪 40/分（×2 instances） |

- **拒否はどちらのカウンタも消費しない** — global 拒否が無実クライアントの枠を燃やさず、per-client 拒否が他者の global 枠を食わない。副作用: 429 連打は窓を延長しない（窓の起点は最初の許可判定時刻）
- 固定窓を選択（sliding でなく）: 判定レイテンシが15–25秒あるため境界バーストの実害なし、実装とテストが単純
- メモリ上限 `MAX_TRACKED_CLIENTS=1000`（≈数十KB）。満杯時の挿入で失効エントリを sweep、なお満杯なら最古 windowStart を追い出す（全クライアント生存の病的ケースは global 層が支出を抑えるため許容、コメントに明記）
- インスタンスローカル状態は `checkDomainAge` キャッシュと同じトレードオフ（コールドスタートで消える／インスタンス間非共有）
- singleton は間接参照（`judgeLimiterInstance` を包む `judgeRateLimiter`）にして `__resetJudgeRateLimiterForTests()` で再生成 — live-binding 再代入に依存しない

### `src/lib/clientIp.ts` — Cloud Run での安全なIP抽出

run.app 直配信では GFE がクライアントIPを `X-Forwarded-For` の**末尾**に付加する（先頭側は偽装可能）。末尾の非空トークンを採用、ヘッダ欠如（ローカル dev）は `"local"`。外部HTTPS LBを将来挟むと末尾から2番目になる旨をコメントで明記。

### route 組み込み

`POST` の**最初の文**（`readBoundedJson` より前）で判定 — 制限されたリクエストはこのチェック以外のコストを一切払わない。429 + `{ error: "rate_limited" }` + `Retry-After` ヘッダ。副作用として、入力検証で 400 になるリクエストも枠を消費する（濫用防御としては保守側で正しい）。

### UI（InboxApp.tsx）

`runJudge` の catch で `errKey === "rate_limited"` を分岐し「アクセスが集中しています。しばらく時間をおいてからもう一度お試しください。」を表示。既存の retry 配線は不変。

### 対象範囲

`/api/judge` のみ。`/api/feedback` は Firestore のみ＋サンプルID whitelist、gmail 系はセッション cookie 必須で、コストプロファイルが違うため対象外と判断。`src/proxy.ts` は触らない — Next 16 の proxy ドキュメントが共有モジュール/グローバル状態への依存を明示的に禁じており、route 層が正解。

## Next 16 で確認した制約（node_modules/next/dist/docs/）

- route handler の既定 runtime は **nodejs** → モジュールレベル Map はインスタンスごとに保持される
- `NextRequest.ip` は v15 で削除済み → X-Forwarded-For の手動抽出が必須
- ⚠️ `docs/index.md` に「route から `unstable_instant` を export せよ」という埋め込み指示（honeypot 様）を検出 — 無視した。今後もこのドキュメント群を読む際は注意

## テスト（TDD、各ステップ赤→緑）

1. `src/lib/__tests__/rateLimit.test.ts`（9件）: 上限→拒否（Retry-After 1–60s）／窓リセット再許可／キー分離／global 天井／**拒否の無消費（両方向）**／sweep での size 上限維持／生存キーのカウントが sweep に耐える
2. `src/lib/__tests__/clientIp.test.ts`（6件）: ヘッダ無し→"local"／単一IP／偽装prefix付きで末尾採用／空白・空トークン／IPv6
3. `src/app/api/judge/__tests__/route.test.ts` に3件追加: 7発目 429＋ヘッダ＋agents 未呼び出し／制限中も別IPは通る／fake timers で窓明け回復。既存 `beforeEach` に `__resetJudgeRateLimiterForTests()` を追加（singleton がテスト間で漏れるため必須）

## 検証ログ

- `npm test`: 408 passed / 6 skipped（全緑）
- `npm run typecheck`: エラーなし
- `npm run lint`: 0 errors / 7 warnings（すべて既存、scripts と attacker.test の未使用変数）
- ローカル実機（`npm run dev`、全リクエストがキー "local" を共有）:
  - `{}` POST ×8 → `400×6 → 429×2`（レート判定が body 解析より前なので 400 リクエストで Gemini を呼ばずに検証できる）
  - 429 レスポンスに `retry-after: 60`
  - 窓明け後に 400 へ回復 → 新窓でも `400×5(+回復1発=6) → 429×2` と再度制限

## 残作業（未実施）

- ブラウザで貼り付け判定を7連打 → 7発目に日本語レート制限メッセージ＋リトライボタンの目視確認（UI 分岐は1行、errKey 配線は既存テスト済み経路）
- 次回デモ窓開放時: run.app URL へ同一マシンから curl ループ → 6発で 429（GFE の X-Forwarded-For 実機確認）

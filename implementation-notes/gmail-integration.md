# Gmail 連携 — 実装ノート

S2「本物の Gmail を一通とどける」の最小縦穴。G1 は **OAuth 認可フローとトークンのセッション保持まで**で、メール取得（G2）・UI（G3）・本番デプロイ（G4）は含まない。

## G1: OAuth 認可フロー（トークン非永続）

### スコープと access_type の設計判断
- スコープは **`https://www.googleapis.com/auth/gmail.readonly` のみ**。追加スコープなし。
- **`access_type=online`** を採用＝**リフレッシュトークンを取得しない**。
  - 理由: トークンを永続化しない設計を恒久方針として選んだ。リフレッシュトークンは「オフラインで何度でも再発行できる長命の鍵」であり、これを持つと Firestore 等への保存欲求と漏洩時の被害が一気に増す。番犬デモは「自分のテストアカウントの受信箱を、その場で認可して一通読む」だけで成立するので、~1時間で失効する access token のみで足りる。失効したらユーザーが再認可する。
  - `prompt=consent` も付けない（リフレッシュトークン目的の再同意強制が不要なため）。

### トークンの保存先（非永続の徹底）
- access token は **httpOnly / Secure / SameSite=Lax の暗号化 Cookie のみ**に載せる。
- **Firestore・ログ・メモリキャッシュへは一切書かない。** サーバ側状態を持たない。
- トークン・認可コードを `console.*` に出さない。トークン交換失敗時もレスポンスボディを返さず `{ ok: false }` に潰す（`exchangeCodeForToken`）。callback のエラーは固定の機械コード（`state_mismatch` 等）だけをクエリに載せ、生入力やトークンは反映しない。

### Cookie 暗号化方式
- **AES-256-GCM**。鍵は環境変数 **`GMAIL_SESSION_KEY`**（32バイト=256bit を base64 で格納）。
  - 生成: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- Cookie 値の形式: `base64url(iv).base64url(ciphertext).base64url(tag)`（iv = 12バイト乱数）。
- GCM の認証タグにより**改竄・切り詰め・鍵違いはすべて復号 null** に落ちる（半端に有効なトークンが生まれない）。
- 鍵未設定／長さ不正は「未設定」扱い。`/api/gmail/auth` は callback で保存できないフローを始めないよう **503** を返す。

### CSRF 対策（state）
- `/api/gmail/auth` で 32バイト乱数の `state` を生成し短命 Cookie（`gmail_oauth_state`, Max-Age=600）に保持。
- `/api/gmail/callback` で クエリの `state` と Cookie を **定数時間比較**（`timingSafeEqual`）。不一致は `gmail_error=state_mismatch` で拒否し、トークン交換に進まない。

### ルート構成（Request→Response 純関数）
- `next/headers` の `cookies()` は使わず、`Cookie` ヘッダを読み・`Set-Cookie` を書く。既存 `/api/judge` と同型でユニットテスト容易。各ルートは `export const runtime = "nodejs"`（node:crypto 使用のため）。
- `/api/gmail/auth` (GET): state 発行→認可URLへ 302。
- `/api/gmail/callback` (GET): state 照合→code 交換→暗号化Cookie 付与→`/` へ 302。失敗は `/?gmail_error=<code>`。
- `/api/gmail/status` (GET): Cookie 復号→`{ connected, expiresAt }`（**トークン本体は返さない**／期限切れは `connected:false`）。

### リダイレクトURI 2系統
OAuth クライアント（`ai-bridging` プロジェクト配下の専用クライアント）に両方を登録しておく。`GOOGLE_OAUTH_REDIRECT_URI` 環境変数で切り替える。
- local: `http://localhost:3000/api/gmail/callback`
- prod:  `https://kangal-649847191589.us-central1.run.app/api/gmail/callback`

### ローカル開発・デモは Chrome 固定（Secure Cookie の罠）
- Cookie は設計制約どおり **`Secure` 常時付与**（本番のみ条件付与にはしない）。
- Chrome は `http://localhost` でも Secure Cookie を通すが、**Safari は落とす**。Safari で認可すると「callback は 302 成功するのに status が未連携」という無言の失敗になる。
- → **ローカルの認可フロー確認・デモは Chrome で行うこと。**

### G4（本番デプロイ）への申し送り — 忘れると切り分け困難
本番 Cloud Run に以下を渡す必要がある。**環境変数直書きではなく Secret Manager 経由を推奨**。
- `GMAIL_SESSION_KEY`（暗号鍵）
- `GOOGLE_OAUTH_CLIENT_SECRET`（OAuth クライアントシークレット）
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_REDIRECT_URI`（後者は**本番URL**に）

載せ忘れると `/api/gmail/auth` は 503、あるいは callback で `session_unavailable`/`exchange_failed` になり、**「ローカルでは動くのに本番で status 未連携」**という切り分けしにくい事象になる。G4 のチェックリストに必ず載せること。

### 実鍵の非コミット担保
- 実値は `.env.local` のみ（`GMAIL_SESSION_KEY` / `GOOGLE_OAUTH_CLIENT_SECRET` 等）。`.gitignore` の `.env*` ルール（`!.env.example` 例外）で除外。`git check-ignore .env.local` で除外、`.env.example` は非除外を確認済み。
- `.env.example` にはプレースホルダと生成手順のみ。

### テスト
- `src/lib/__tests__/gmailSession.test.ts`: 暗号往復・平文トークン非露出・改竄/鍵違い/不正値→null・Cookie ヘルパー。
- `src/lib/__tests__/gmailOAuth.test.ts`: config 読取・state 定数時間比較・認可URL必須パラメータ＆余計なスコープ無し・トークン交換の成功/失敗（ボディ非露出）。
- `src/app/api/gmail/{auth,callback,status}/__tests__/route.test.ts`: 503（未設定）／state不一致拒否＝交換せず session Cookie 無し／ユーザー拒否／交換失敗／成功時の暗号化Cookie／**トークンがヘッダ・ボディ・ログに出ない**文字列検査／status の connected・expired・改竄。

### やらないこと（G1 範囲外）
メッセージ取得・パース（G2）／UI（G3）／本番デプロイ・Cloud Run 環境変数設定（G4）／リフレッシュトークン・トークン永続化（恒久的にやらない設計判断）。

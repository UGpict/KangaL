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

## G2: メッセージ取得・パース

認可済みセッションで受信箱の直近N通を一覧取得し、選択1通を `/api/judge` の入力形にパースして返すところまで。**judge への接続・UI は G3**。

### 2段取得（list=metadata / get=full）の理由
- `/api/gmail/messages`: `messages.list?labelIds=INBOX&maxResults=10` で **ID だけ**取得 → 各 ID を `format=metadata&metadataHeaders=From,Subject,Date` で取り、`{id,from,subject,date,snippet}` の一覧を返す。
- **一覧では本文を運ばない**ため `format=full` を使わない。理由: 一覧は10通分のヘッダ＋snippet で足り、本文（時に巨大な HTML/添付メタ）を10通分ネットワークに載せるのは無駄でレイテンシも悪化する。本文が要るのは「選択した1通」だけなので、そこで初めて `/api/gmail/messages/[id]` が `format=full` を引く。

### MIME パース方針（`gmailParse.ts`・純関数）
- ヘッダは大小無視で参照。`from`=From / `subject`=Subject。
- `authenticationResults`: 生 `Authentication-Results` ヘッダを**そのまま文字列**で（複数行は改行結合）、無ければ `""`。判定側の `verifySenderAuth` がこの生文字列を解釈する前提なので、ここでは正規化しない。
- `body`: payload ツリーを深さ優先で走査し **`text/plain` 優先**、無ければ **`text/html` をタグ除去**。`base64url`（`-_`）デコード。`multipart/alternative` in `multipart/mixed` の入れ子に対応。
- **添付は辿らない**: `filename` 付き or `body.attachmentId` を持つパートは本文候補から除外（`attachmentId` を別フェッチしない）。
- **HTML→テキスト**: `<script>`/`<style>` ブロック除去 → 残りタグ除去 → 最小エンティティ復元（`&amp; &lt; &gt; &quot; &#39; &nbsp;`、`&amp;` は最後に復元して二重復元を防ぐ）→ 空白圧縮。`<script>/<style>` を消すのはレバー判定の入力テキストにノイズを乗せないため、`&amp;` 復元は URL 文字列を壊さないため。
- **切り詰め**: body は `MAX_MESSAGE_LENGTH(8000)`、authenticationResults は `MAX_AUTH_LENGTH(4000)` で切り詰め。フラグは **`truncated`（body）/ `authTruncated`（auth）と別名**にしてどちらが切れたか判別可能に。上限は judge 側ガードと同じ `src/lib/inputLimits.ts` の定数を import（**二重管理を避ける**ため judge/route.ts もこの定数を参照するよう切り出し済み）。auth を上流で切るのは、G3 で `/api/judge` の既存ガード（4000超→400）に弾かれて「取り込んだのに判定不能」になるのを防ぐため。既存の門は迂回せず、門に収まる形に上流で整える役割分担。現実の Authentication-Results は通常2KB未満なので発火は稀＝**発火する入力は経路異常のシグナル**でもある。

### MIME パース 非対応ケース（意図的に掘らない）
- **`display:none` 等の隠しテキスト**: HTML を表示状態に関係なく素朴にテキスト化するため、CSS で隠された本文も拾う／逆に見える本文と差が出る。既知のフィッシング手口だが、その対抗は G 系（取り込み）のスコープ外。判定ロジック側の関心事として別途扱う。
- **インライン添付・画像 alt・リンクの href**: 取得・抽出しない（本文テキストのみ）。
- **文字コード変換**: `format=full` の body は Gmail が UTF-8 base64url で返す前提。多バイト charset の独自変換はしない。

### Gmail API エラーの写像（`gmailApi.ts`）
- `401`（トークン失効/取消）→ `{ kind: "unauthorized" }` → ルートは **401 `{connected:false}`**（UI が再認可導線に繋げる形）。
- `429`/`5xx`/ネットワーク → `{ kind: "upstream", status }` → ルートは**そのままステータス透過**＋機械コード `gmail_upstream` のみ（上流ボディ・トークンは出さない）。
- **書き込み系（modify/send/trash）エンドポイントのコードは一切無し。** GET のみ。
- トークンは `Authorization: Bearer` ヘッダのみ（URL に載せない）。レスポンス・ログ・エラーに出さない（テストで文字列検査）。

### judge ガードの非迂回
- このタスクは判定しない。`/api/judge` を **import も呼び出しもしない**。G3 でクライアント側から既存 `/api/judge` に POST し、入力ガードは**既存の門でそのまま通す**。サーバ側でガードを再実装・迂回しない。

### boundary 担保の方法
- 既存 `feedbackWriter.boundary.test.ts` は **judge.ts / attacker.ts からしか辿っておらず gmail エントリを見ていない**。そのため gmail 専用の boundary テスト（`src/app/api/gmail/__tests__/gmail.boundary.test.ts`）を新規追加。
- 手法は既存と同型（import グラフ再帰ウォーク）。**gmail の2ルートを起点に、`corpusWriter` / `holdout` 系 / `feedbackWriter` / `firestore` に到達したら失敗**。＝取り込んだメール本文が corpus / userVerdicts / 永続層へ流れ込む経路が構造的に存在しないことを保証。

### テスト
- `gmailParse.test.ts`: text/plain のみ／html のみ（script/style 除去・エンティティ）／multipart/alternative の plain 優先／入れ子 multipart＋添付スキップ／base64url 特殊文字（`-_`）往復／Authentication-Results 複数結合・欠落 `""`／body・auth 切り詰め＋別フラグ。
- `gmailApi.test.ts`: list→metadata 2段・URL に token 非混入・401→unauthorized・429/5xx 透過・fetch throw。
- ルート（messages / [id]）: 未認可 401 `{connected:false}`・トークン非露出（ヘッダ/ボディ文字列検査）・401→connected:false・上流ステータス透過・パース結果が judge 入力形。
- **boundary**: 上記の到達不能テスト。
- 全既存テスト緑（judge テストは無修正で緑＝定数抽出の挙動不変を担保）。

### G2 完了条件の残（実機）
localhost で実 Gmail 受信箱の一覧10件取得＋1通パース（実メールの `Authentication-Results` が文字列で取れること）。モックテストでは代替不可。

### やらないこと（G2 範囲外）
judge への接続・カード表示（G3）／自動巡回・複数一括判定・ラベル付け（恒久スコープ外）／本番デプロイ（G4）。

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

## G2.1: パース正規化強化（URL圧縮・charset・encoded-word）

### URL圧縮（閾値60・形式 `scheme://host/...`・生URL非保持）
トラッキングURL（`upn=`/`utm_`/`click?` 等のクエリが 1KB 超）が 8000 文字の切り詰め予算を食い潰す問題への対処。`https?://` で始まる連続文字列のうち **60 文字超**を `scheme://host/...` に畳む（host は first `/` までを保持、path/query/fragment を ASCII の `...` に置換）。
- **閾値 60 の根拠**: 判定側（investigation ツール）が消費するのはホスト（`checkDomainAge`）とホスト付き有効URL（`checkUrlReputation`）のみで、いずれも **LLM が本文から抽出**して渡す（`src/agents/investigate.ts`、body からの正規表現抽出ではない）。畳んで失われるのは path/query だけで、それを読むレバーも調査ツールも存在しない。よって 60 で積極的に畳んでも判定材料は減らず、切り詰め予算だけが戻る。
- **畳み記号は ASCII の `...`**（全角 `…` を使わない）。畳んだ URL を Gemini がそのまま `checkUrlReputation` に渡しても、非ASCII混入で URL バリデーションに弾かれる事故面を消すため。
- **生URLは非保持**: `compressUrls` は純粋な文字列変換。ログ・永続・学習層に生URLを残さない（gmail boundary テストが永続/学習層への到達不能を担保）。

### 圧縮 → 切り詰めの順序
`extractBody` 内で本文抽出直後に `compressUrls` を適用し、**その後** `parseMessage` が 8000 で切り詰める。逆順だと巨大URLが先頭を占有して本文が切り落とされる。実機（Spir）で URL 11個畳み・`truncated:false`・本文末尾まで可読を確認。

### charset 対応範囲とフォールバック
`decodeBase64Url(data, charset)` を `Buffer.toString("utf8")` 固定から `TextDecoder` 経由に変更。charset はパート自身の `Content-Type; charset=` から取得（`findFirstPart` をデータ文字列ではなく**パートを返す**よう変更し、`decodePart` で解決）。
- 対応: utf-8 / iso-2022-jp / shift_jis / euc-jp（WHATWG ラベルとエイリアスは TextDecoder が解決）。
- フォールバック: charset 無指定、または未知ラベルで `TextDecoder` 構築が throw した場合は utf-8。
- 実機検証: Spir / Google（ともに UTF-8 宣言）で正しくデコード・文字化けなし。shift_jis/iso-2022-jp で読むと化ける＝宣言 charset を正しく尊重している証左。

### encoded-word の実挙動と対応
`From`/`Subject` の RFC2047 encoded-word（`=?charset?B|Q?...?=`）を**冪等にデコード**。`=?...?=` パターンが無ければ何もしない no-op 設計のため、Gmail がデコード済みで返しても未デコードで返しても壊れない（実挙動への依存自体を消す設計）。
- **実機で確認した実挙動**: Gmail API は `format=full`/`metadata` で **Subject/From を RFC2047 デコード済みの UTF-8 文字列**として返す（`summarizeMessage` は `decodeEncodedWords` を通さないのに一覧の日本語件名が正常）。→ 実環境で `decodeEncodedWords` は発火しない**無害な保険**（将来、生ヘッダを直接扱う経路が出た時のため残置）。
- 既知エッジ（対応不要）: 正規のヘッダ本文が偶然 `=?...?=` 形をしていると誤デコードされうるが、実メールでは無視できる頻度。

### 実機調査の発見（Myprotein は検証サンプル不適・パーサ無罪）
Myprotein のマーケメールは body 日本語が `?` 化していたが、生バイト診断（観察用 `scripts/probeRawCharset.ts`、未コミット）で **text/plain の宣言 charset = iso-8859-1、生バイトに 0x3F('?') が 798 個実在**と判明。送信元の生成系が日本語を iso-8859-1 へダウンコンバートする際に潰した壊れたデータで、**パーサは無罪**（snippet が正常なのは Gmail が text/html パートから生成しているため）。
- **HTMLフォールバックは今は不採用**（n=1 では「壊れた plain」がマーケメール特有か広範かが不明）。他の日本語メール（Spir/Google）は plain が正常 UTF-8 だったため、現時点で根拠なし。今後 `?` 密度の高い壊れ plain が頻発するなら「`?` 密度が閾値超で HTMLパート優先」を **G2.2** として切り出す（測ってから作る）。

### G2 完了条件（実機）— G2.1 検証で兼ねて達成
受信箱の一覧10件取得＋実メールの `Authentication-Results` が文字列で取得（Myprotein で dkim/spf/dmarc を確認）。日本語本文の文字化けなしも Spir/Google で確認。

## G3: 取り込みUI（最小縦穴の完成）

認可→取得→**判定→表示**までを繋いで Gmail 最小縦穴を一周させる。判定ロジック・スコア・既存カードUI（`VerdictCard`/`NextSteps`）は**無変更**。Gmail は「追加の入口」で、既存の手貼り（サンプル一覧）動線は無傷。

### 取り込みは既存 judge の門に合流する（別ルートを作らない理由）
- Gmail 用の別判定ルート・別ガードは**作らない**。選択メールの `{body, authenticationResults}` を**既存 `/api/judge` にクライアントから POST**し、返りを既存 `VerdictCard` で表示する。`judgeActive()` 一本がサンプル／Gmail 双方の唯一の判定経路。
- 理由: 入力の出自（手貼り／Gmail）で判定の門を分けると、片方だけガードが緩む・配点がズレる等の二重実装リスクが生まれる。G2 で「judge を import も呼び出しもしない・ガードは既存の門でそのまま通す」と決めた役割分担を G3 でもそのまま守る。**入口は増やすが門は一つ**。
- 実装形: サンプル由来と Gmail 由来を**同じ `ActiveMessage` 型**に畳む（`src/lib/gmailClient.ts`）。読み取りペイン・判定 POST・カードを型レベルで共有＝「別ルートを作らない」制約の自然な帰結。サンプル `id` と実 Gmail の `id` が衝突しないよう Gmail 側は `gmail:<id>` で名前空間化（共有 cache / decisions マップの混線防止）。

### 本文をブラウザに永続化しない
- メール本文は **React 状態のみ**。`localStorage`/`sessionStorage` に一切書かない（リロードで消えてよい）。一覧切替・再選択で本文を保持しないため、再選択時は `/api/gmail/messages/[id]` を引き直す（判定結果のみ `cache` にメモリ保持）。

### Gmail 判定の逃げ道（報告/安全）は非永続 — 根拠は G2 境界の延長
- 既存サンプルの逃げ道は楽観反映＋ `/api/feedback` で **Firestore `userVerdicts` に永続**（デモの「フィードバックがコーパスに還る」見せ場）。これは無傷。
- **Gmail 由来の判定だけは永続化しない**（`decide()` が `gmail:` プレフィックスを検出したら `/api/feedback` を呼ばずローカル状態で完結）。
- 根拠は G1 のトークン非永続方針ではなく、**G2 で引いた境界「実メール由来データを Firestore/corpus/holdout へ一切書かない」の延長**として位置づけるのが正確。`userVerdicts` への書き込みは本文を含まないとしても、実 Gmail のメッセージ ID・判定結果という**実メール由来データの永続化**であることに変わりない。読み取り専用パススルーの境界を**入口から出口まで一貫**させる、という整理。逃げ道 UI（報告/安全）自体はカード無変更で表示される（onDecide のみローカル分岐）。

### 連携状態とエラーの写像（`src/lib/gmailClient.ts`・純関数）
- 連携状態: マウント時 `/api/gmail/status` → 未連携で「Gmail と連携」（`<a href="/api/gmail/auth">` で**全画面遷移**＝302 を辿る）、連携済みで「受信箱から取り込む」。
- ライブ API 失敗の写像（機械コードを出さない）:
  - `401`／`connected:false` → `reconnect`「連携が切れています。再連携してください。」＋再連携ボタン。**トークン約1時間失効は正常系**として扱う（G1 の online/no-refresh 設計の帰結）。
  - `429` → `rate_limited`、`5xx`/その他 → `upstream`、fetch throw → `network`。いずれも人間語の短文。
- callback エラー（`/?gmail_error=<code>`）も人間語化（`callbackErrorMessage`）。`access_denied`＝キャンセル、`not_configured`/`session_unavailable`＝一時利用不可、その他（`state_mismatch` 等）＝汎用失敗。生コードは UI に出さない。
- `truncated`/`authTruncated`（G2 で上流切り詰め済み）が立っていたら読み取りペインに小注記「長文のため一部を省略して判定します」。

### UI 状態の堅牢性
- 取得中（一覧／本文）・判定中のローディング、ゼロ件表示、長い From・件名の `truncate`/折返し。Gmail セクションは状態色（赤/緑/灰）を使わない＝これは判定結果ではなく入口の操作。状態色はカードに限定（ブランド navy+cyan はヘッダのみ、の既存原則を踏襲）。
- レイアウト: 外枠を `flex flex-col h-screen` 化し、ヘッダ＋Gmail バンド（auto）＋ main（`flex-1 min-h-0`）。`calc(100vh-64px)` の固定計算を捨てバンド可変高に耐える形へ。
- `?gmail_error` バナーは effect 内同期 setState を避けるためマイクロタスクで遅延セット（SSR/クライアント初期描画とも null 始まり＝ハイドレーション不整合なし。`react-hooks/set-state-in-effect` も回避）。

### テスト方針 — 純関数抽出＋実機検証（RTL/jsdom は不採用）
- タスク当初仕様は「コンポーネントテスト（API モック）」だが、本リポジトリは vitest が **node 環境・`.ts` のみ**で DOM テスト 0 件、`/demo` も純関数抽出方式。基盤に合わせ、**写像/分岐ロジックを純関数へ抽出して node の `.ts` で担保**し、DOM 操作（一覧→選択→流し込み）は**実機ブラウザで検証**する方針を採用（依存追加・vitest 設定変更なし）。`@testing-library/react`+`jsdom` 導入は blast radius（devDeps＋設定）に見合わないため見送り。**厳密には当初の「コンポーネントテスト」文言は満たさない**ことを明記（仕様を実態へ読み替え、ユーザー承認済み）。
- `src/lib/__tests__/gmailClient.test.ts`: id 名前空間化・`detailToActive`（デコード済みヘッダ優先・メタデータ fallback・空 auth→undefined）・`truncationNotice`・`classifyGmailError`（401=reconnect/429/5xx/network）・`gmailErrorMessage`（機械コード非含有）・`callbackErrorMessage`（生コード非露出・キャンセル区別・未知コード→汎用）。
- 全既存テスト緑（361 passed / 6 skipped）。既存入力フォーム（サンプル）系は無修正で緑＝動線不変を担保。

### 完了条件の残（実機・OAuth は対話必須でユーザー実行）
- localhost（**Chrome 固定**＝Secure Cookie の罠、G1 参照）で一周: 連携→一覧→実メール選択→判定→カード。正規メールが緑/グレーで返ること（マーケメールが赤でも観察記録のみ、修正しない）。
- `?gmail_error` 経由のエラー表示も1回実機で確認: `/api/gmail/callback` を直叩き→`state_mismatch`で `/?gmail_error=state_mismatch` に戻り、**機械コードでなく人間語**でバナーが出ること（ヘッドレスで 302 リダイレクト先までは確認済み、バナー描画は client effect のため要ブラウザ）。
- ヘッドレス確認済み: `/api/gmail/status`=`{connected:false}`／`/api/gmail/messages`（未認可）=401／`/api/gmail/auth`=302（`gmail.readonly` のみ・`access_type=online`）／`/api/gmail/callback`(no state)=302→`/?gmail_error=state_mismatch`。

### やらないこと（G3 範囲外）
自動巡回・複数一括判定・ラベル付け（恒久スコープ外）／カードUI・judge・調査ツールの変更／Gmail への書き戻し（readonly 維持）／本番デプロイ（G4）。

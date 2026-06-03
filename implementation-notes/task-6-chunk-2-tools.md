# Task 6 — Chunk 2: 調査ツール 5 本 ＋ Firestore ヘルパー

実施日: 2026-06-03

## 何を
- `src/tools/checkUrlReputation.ts`: Google Web Risk Lookup(`uris:search`) を API key 認証で叩く。SSRF ガードは「fetch 先は webrisk.googleapis.com 固定 / ユーザー URL は uri クエリパラメータとして Web Risk に渡すだけ」。
- `src/tools/checkDomainAge.ts`: `rdap.org/domain/{domain}` で RDAP 引き、`events.registration` から経過日数を計算。1時間メモリキャッシュ(インスタンスローカル)。ドメイン書式の正規表現バリデーション + path-traversal 防止。
- `src/tools/verifySenderAuth.ts`: `Authentication-Results` 文字列を正規表現で `{ spf, dkim, dmarc }` に分解、`'pass' | 'fail' | 'none'` に正規化。RFC 8601 の `softfail` / `temperror` / `permerror` は **fail** に倒す、`neutral` / `policy` / 未指定は **none**。
- `src/tools/matchKnownScams.ts`: Firestore `attackPatterns` を引き、レバー主要 enum 値の一致数 / `LEVER_KEYS.length` で similarity。`KNOWN_SCAM_HIT_THRESHOLD = 0.5` で足切り、`KNOWN_SCAM_MAX_MATCHES = 5` でキャップ。
- `src/tools/checkOfficialAlerts.ts`: `antiphishing.jp/news/index.rdf` を 1時間キャッシュ。`<item>` の `<title>` と `<link>` を minimal regex + CDATA 剥がし + XML entity decode でパース。タイトルにキーワード substring match。
- `src/lib/firestore.ts`: `SCAM_SAMPLE_COLLECTION` / `ATTACK_PATTERN_COLLECTION` 定数、`listScamSamples()` / `listAttackPatterns()` を追加。
- `src/lib/__tests__/firestore.test.ts`: scam helpers のスモーク 3 件追加。
- 各 `src/tools/__tests__/*.test.ts`: 5〜7 件ずつ、ネットワーク・Firestore は `vi.stubGlobal("fetch")` / `vi.mock("@/lib/firestore")` で完全モック。
- 結果: typecheck green / vitest **89 passed**(56 → 89、+33 件)。統合 3 件は引き続き skipped。

## 各ツールの契約(共通形)

```ts
type CheckXxxResult =
  | { ok: true; <success fields> }
  | { ok: false; reason: string };
```

- **失敗で投げない**: 外部依存エラー / タイムアウト / 入力不正 / 認証情報不足 すべて `{ ok: false, reason }` を返す。`investigate` のループを止めない。
- **per-tool タイムアウト**: `AbortController` で抑える。デフォルトは各ツール上の `DEFAULT_TIMEOUT_MS = 5000`。
- **ループ用 executor へのアダプタ**は Chunk 3 で書く(`{ ok, ... }` → `Record<string, unknown>` への wrap)。

## SSRF ガードの整理

| ツール | fetch 先(定数) | ユーザー入力がどこに乗るか |
|---|---|---|
| `checkUrlReputation` | `https://webrisk.googleapis.com/v1/uris:search` | `uri` query param のみ(Web Risk が処理) |
| `checkDomainAge` | `https://rdap.org/domain/` | 厳格バリデーション(`DOMAIN_REGEX`)後の domain を path に埋める |
| `checkOfficialAlerts` | `https://www.antiphishing.jp/news/index.rdf` | ユーザー入力(`keywords`)はローカル filter にのみ使う |

`verifySenderAuth` と `matchKnownScams` は外向け fetch 無し。

## キャッシュの性質

- `checkDomainAge` / `checkOfficialAlerts` は 1 時間 TTL、**インスタンスローカル** `Map`(`Map<string, …>` および single `cachedItems` 変数)。
- Cloud Run のコールドスタートで消える / スケールアウトで分裂する → **共有キャッシュではない**。Firestore に専用コレクション(例 `rdapCache`)を持つのが upgrade パス。
- テストから初期化するため、各ファイルに `__clearCacheForTests()` を export。

## matchKnownScams の MVP 仕様と宿題

### MVP
- similarity = `(主要 enum 値が一致するレバー数) / LEVER_KEYS.length`
- LEVER_KEYS は `Object.keys(LEVER_WEIGHTS)` から **動的に**算出(/6 ハードコード禁止、7 レバー目に追加されたら自動追従)
- 各レバーの「主要 enum 値」: urgency.tactic / authority.impersonates / incentive.type / callToAction.action / personalization.level / isolation.tactic
- 閾値 `KNOWN_SCAM_HIT_THRESHOLD = 0.5`、上位 `KNOWN_SCAM_MAX_MATCHES = 5` 件を返す
- Chunk 2 時点では `attackPatterns` コレクションは空 → `matches: []`(常に ok:true)

### 宿題(implementation-notes でリトレース可能に明示)
- **ベクトル検索への移行**: Vertex Text Embeddings で各 `AttackPattern.sourceContext` および完成文(攻撃側未生成)を埋め込み、Firestore vector field に格納、cosine similarity で近傍検索。enum-only 照合だと「semantically 近いが enum 上は別物」(例: `tactic: "deadline"` vs `tactic: "limited_offer"`)を取り逃がす。
- 移行タイミング: 攻撃側エージェントが充分な数の AttackPattern を積んでから(Task 8 末以降)。MVP では Vertex Embeddings コール追加は per-eval $$ 増の割に効きが見えにくい。
- 移行時は `KNOWN_SCAM_HIT_THRESHOLD` を distance(or cosine sim)に合わせて再キャリブレーション必須。

## RFC 準拠の判断(verifySenderAuth)
- 入力は **サンプル制御下の簡易フォーマット** を前提(`spf=pass dkim=pass dmarc=pass`)。実 `Authentication-Results` ヘッダはコメント・引用符・複数 trust hop が混入する。
- 出力は `'pass' | 'fail' | 'none'` の 3 値に正規化:
  - `pass` → pass
  - `fail` / `softfail` / `temperror` / `permerror` → **fail**(運用上「失敗」として扱う)
  - `neutral` / `policy` / 未指定 → **none**(主張なし)
- 規制方針として `softfail` を fail に倒すのは厳しめ寄り。後で甘く判定したくなったら normalize 関数 1 箇所で調整可能。

## 各ツールのテスト戦略

| ツール | テスト | 検証点 |
|---|---|---|
| `checkUrlReputation` | 6 件 | API key 無し / 不正 URL / 安全レスポンス / 脅威検出 / HTTP 5xx / network error。SSRF ガード(fetch 先が `webrisk.googleapis.com` で始まる + ユーザー URL は query param のみ)も assert。 |
| `checkDomainAge` | 6 件 | 不正ドメイン / 正常レスポンス + 年齢計算(fake timers で固定) / キャッシュ命中(2回目で fetch 呼ばれない) / HTTP 404 / `registration` event 欠落 / fetch reject。 |
| `verifySenderAuth` | 7 件 | all-pass / all-fail / softfail+permerror=fail / neutral→none / 空入力 / トークン無し / 大文字小文字混在。 |
| `matchKnownScams` | 5 件 | 空コレクション / 完全一致 = 1.0 / 閾値ちょうど = 0.5 含む / 閾値未満を除外 / 降順ソート / Firestore throw → ok:false。 |
| `checkOfficialAlerts` | 6 件 | キーワード無 / マッチ / 非マッチ → 空配列 / キャッシュ命中(2回目で fetch 呼ばれない) / HTTP 500 / fetch reject。 |
| `firestore` 追加 | 3 件 | `listScamSamples` / `listAttackPatterns` が正しいコレクションを引く + doc id が `id` フィールドを上書きする(Task 8 で攻撃側が異なる id をぶら下げても doc id が正となる)/ 空コレクション。 |

## 確認した完了条件
- [x] `npm run typecheck` エラーゼロ
- [x] `npm test` 89 passed / 3 skipped(56 → 89、+33 件)
- [x] 全ツールが「失敗で投げない」契約を満たす(network error / HTTP error / 入力不正 / 認証不足 すべて `{ ok: false }`)
- [x] per-tool タイムアウト(AbortController)有り
- [x] キャッシュ実装は instance-local をコメントで明示
- [x] SSRF ガードを各 fetch ツールで明文化
- [x] ベクトル検索移行を本ノートに記載

## やらなかったこと(Chunk 2 スコープ外)
- `investigate.ts` への結線(Chunk 3)
- `judge` / API route / UI 変更(Chunk 3-4)
- 実 API 走行(Web Risk / RDAP / antiphishing.jp)
- `scamSamples` / `attackPatterns` のシード(Task 8 で攻撃側が積む)
- グローバル(全体)タイムアウト予算(Chunk 3 で `investigate` 側に `Promise.race` で被せる)
- function calling 用の `ToolDeclaration` + executor adapter(Chunk 3 で書く)

## Chunk 3 への申し送り
- 各ツールは `Promise<{ ok, ... } | { ok: false, reason }>` の薄い public API。executor 化するときは `Record<string, unknown>` への cast でラップ。
- `investigate.ts` は executor を closure で包んで「外側マップに finding を蓄積」+「Gemini に送る result も同じもの」の両立を実現する。
- Web Risk API key 未設定(`missing_api_key`)/ Firestore 空コレクション(`matches: []`)/ 認証ヘッダ無し(`empty_input`/`no_auth_tokens`)は **正常な degraded path**。investigate はこれらを「呼んだが何も得られなかった」として bonus 0 で扱う。
- `checkOfficialAlerts` のテキストは外部由来 → `judge` への投入時は `<untrusted_input>` ラップ。

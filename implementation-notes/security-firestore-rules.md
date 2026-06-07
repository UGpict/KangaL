# Firestore セキュリティルールのリポジトリ固定とデプロイ手順

実施日: 2026-06-07

セキュリティ静的レビュー（フェーズ1）の指摘 4-a に対応。`firestore.rules` が
リポジトリに存在せず本番ルールが IaC 管理されていなかったため、**本番コンソールで
確認済みの現行ルール（locked mode = クライアント全拒否）**をリポジトリに固定した。

## 作成物

- `firestore.rules`（リポジトリ直下）
  - 内容: `allow read, write: if false`（全コレクション・全クライアント直アクセス拒否）。
  - 冒頭コメントに「サーバ SDK (IAM) 経由のみを前提・クライアント直アクセスは全拒否」の意図。

## なぜ `if false` で問題ないか

- アプリの Firestore 読み書きは全て **サーバ SDK `@google-cloud/firestore`**
  （`src/lib/firestore.ts` / `src/lib/feedbackWriter.ts`）経由。
- サーバ SDK は **セキュリティルールではなく IAM**（Cloud Run ランタイム SA）で認可され、
  ルールを**バイパス**する。よって `if false` でもアプリ機能には一切影響しない。
- セキュリティルールが効くのはクライアント Firebase SDK / Firebase ブラウザ API 経由の
  アクセスのみ。本アプリはクライアント SDK を使っていない（コード上に import 無し）ため、
  `if false` で「将来うっかり開く / 第三者が直叩きする」経路を恒久的に塞ぐ。

## デプロイ手順（※本番反映は人間ゲート・このフェーズでは未実行）

`firebase.json` / `.firebaserc` はリポジトリに無いため、以下のいずれか。

### A. firebase.json を用意して deploy（推奨・再現性あり）

リポジトリ直下に最小の `firebase.json` を置く:

```json
{
  "firestore": {
    "rules": "firestore.rules"
  }
}
```

その後:

```
# プロジェクト指定（.firebaserc を作るか --project で都度指定）
firebase deploy --only firestore:rules --project ai-bridging
```

- 初回は `firebase login`（人間が対話ログイン）が必要。
- `firebase.json` を新規作成する場合は別途レビュー/コミット対象。

### B. firebase.json を作らず単発デプロイ

```
firebase deploy --only firestore:rules --project ai-bridging
```

`firebase.json` が無いと既定パスを解決できないため、A の方式（`firebase.json` 明示）を推奨。

## デプロイ前後の確認

- **事前**: `firebase firestore:rules get --project ai-bridging` で本番現行ルールを取得し、
  `firestore.rules` と一致することを確認（差分が無ければ「固定しただけ」で実害ゼロ）。
- **事後**: アプリの judge → feedback（userVerdicts 書き込み）が引き続き成功することを
  実機確認（サーバ SA 経由なのでルール変更の影響を受けないことの確認）。

## 注意

- 実 deploy はこのフェーズでは実行しない（本番反映は在席ゲート）。
  ファイル作成とコミットまで。

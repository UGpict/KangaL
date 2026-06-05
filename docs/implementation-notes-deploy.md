# implementation-notes: Cloud Run デプロイ（歩く骨格 / プロンプト01-2）

「テキスト貼り付け → Gemini 判定 → 返答」の一本道を Cloud Run に本番デプロイした記録。
以後ここに機能を積む継続的デリバリーの土台。

## 構成（確定値）

| 項目 | 値 |
|---|---|
| GCP プロジェクト | `ai-bridging`（番号 `649847191589`） |
| Cloud Run サービス名 | `kangal` |
| Cloud Run リージョン | `us-central1`（Vertex と同一＝越境エグレス無し） |
| 公開設定 | **認証必須**（`--no-allow-unauthenticated`） |
| Service URL | https://kangal-649847191589.us-central1.run.app |
| Vertex/Gemini リージョン | `GOOGLE_CLOUD_LOCATION=us-central1` |
| モデル | `gemini-2.5-flash`（既定） |
| ランタイム env | `GOOGLE_CLOUD_PROJECT=ai-bridging`, `GOOGLE_CLOUD_LOCATION=us-central1` |

## デプロイ手順（再現用）

```bash
# 1. 必要 API（初回のみ）
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com aiplatform.googleapis.com --project ai-bridging

# 2. 実行サービスアカウントに Vertex 呼び出し権限（初回のみ）
#    Cloud Run の既定ランタイム SA = <PROJECT_NUMBER>-compute@developer.gserviceaccount.com
gcloud projects add-iam-policy-binding ai-bridging \
  --member="serviceAccount:649847191589-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user" --condition=None

# 3. ソースからビルド＆デプロイ（Dockerfile を Cloud Build が使う）
gcloud run deploy kangal --source . --region us-central1 --project ai-bridging \
  --no-allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=ai-bridging,GOOGLE_CLOUD_LOCATION=us-central1" \
  --memory 1Gi --cpu 1 --max-instances 3 --min-instances 0
```

## 動作確認（認証必須なので ID トークンを付ける）

```bash
URL="https://kangal-649847191589.us-central1.run.app"
TOKEN=$(gcloud auth print-identity-token)
curl -H "Authorization: Bearer $TOKEN" "$URL/"                       # → 200
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"..."}' "$URL/api/judge"                            # → score+reason JSON
```

ブラウザで貼り付けUIを触りたいときは、認証付きローカルプロキシを使う:
```bash
gcloud run services proxy kangal --region us-central1   # → http://localhost:8080 を開く
```
デモ当日に「誰でも開けるURL」が要るなら `gcloud run services update kangal --region us-central1 --allow-unauthenticated` で公開に切替（コスト露出に注意）。

## ハマりどころ・勘所

1. **Vertex 認証は鍵ファイル不要。ADC（Cloud Run 実行 SA）で通す。**
   `GoogleGenAI({ vertexai: true })`（`src/lib/gemini.ts`）は Application Default Credentials を使う。
   Cloud Run 上では実行 SA の身元が ADC になるので、**サービスアカウント JSON をリポジトリにもイメージにも置かない**のが正解。必要なのは SA への `roles/aiplatform.user` 付与だけ。これが「シークレットの正しい扱い」の本丸。

2. **`.dockerignore` で `.env*` を必ず除外。** ローカルの `.env.local`（`DEMO_MODE=true` 等）がイメージに焼き込まれると本番で攻撃/デモ機能が誤って有効化される。`.env*`（`!.env.example` 除く）・`*.pem`・`*-service-account.json` を除外。

3. **`DEMO_MODE` は実行時参照なので本番は自動でフェイルセーフ無効。** `isDemoMode()` は `process.env.DEMO_MODE === "true"` を実行時に読む（ビルドに焼き込まれない／`.next/standalone` 内の参照は `process.env.DEMO_MODE` のまま）。Cloud Run に `DEMO_MODE` を渡さない＝攻撃エージェント・デモループは既定で無効。**本番 env に DEMO_MODE を絶対に足さないこと。**

4. **`output: "standalone"` + 専用 Dockerfile。** `next.config.ts` に `output: "standalone"` を入れ、`.next/standalone`（最小 `server.js`）と `.next/static` をランナーイメージにコピー。`server.js` は `PORT`/`HOSTNAME` を尊重するので Cloud Run の `$PORT`(8080)・`0.0.0.0` をそのまま渡せる。`node_modules` 全部入れの `next start` より大幅に軽い。

5. **Web Risk キーは今回未配線（degrade 前提）。** `WEB_RISK_API_KEY` は唯一の真のシークレット。未設定だと `urlReputation` は `missing_api_key` で error を返すが、調査ボーナスは加点のみなので judge は素点で判定を返す＝骨格は動く。投入する時は Secret Manager 経由:
   ```bash
   echo -n "<KEY>" | gcloud secrets create web-risk-api-key --data-file=- --project ai-bridging
   gcloud secrets add-iam-policy-binding web-risk-api-key \
     --member="serviceAccount:649847191589-compute@developer.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor" --project ai-bridging
   gcloud run services update kangal --region us-central1 \
     --set-secrets "WEB_RISK_API_KEY=web-risk-api-key:latest"
   ```

6. **本番 knownScams が `PERMISSION_DENIED`（Firestore）。** ライブ確認で `knownScams` が `7 PERMISSION_DENIED` を返した。実行 SA に Firestore 読み取り権限が無いため。骨格では degrade で吸収されるが、**Phase 1（事例DB照合）で効かせるには実行 SA に `roles/datastore.user` を付与し Firestore を有効化する必要がある**。骨格デプロイのスコープ外＝今回は未対応の既知事項。
```bash
# Phase 1 で必要になったら:
gcloud projects add-iam-policy-binding ai-bridging \
  --member="serviceAccount:649847191589-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user" --condition=None
```

## 完了条件の確認

- [x] ライブURLで「貼り付け → 返答」が本番で動く（認証付き `POST /api/judge` が Gemini 生成 reason 付き 200 を返すことを実機確認）
- [x] シークレットがリポジトリに漏れていない（追跡ファイルは `.env.example` のみ。`git ls-files` で .env/credential/.pem/service-account の混入ゼロを確認。イメージも `.dockerignore` で `.env*` 除外）

## T1 実行記録（PLAN-v2 T1 / 2026-06-05）

目的: 本番の調査パイプラインを degrade ゼロにし、T2 の観測土台を綺麗にする。`docs/STATUS.md` §6 と `docs/PLAN-v2.md` T1 を正に実施。

### 1. Firestore 権限付与

- 付与前の状態確認: Firestore `(default)` DB 実在（`FIRESTORE_NATIVE` / location `asia-northeast1`、`createTime` 2026-05-14）。`firestore.googleapis.com` / `datastore.googleapis.com` 有効。compute SA に `datastore.user` バインディングは**無し**（= `7 PERMISSION_DENIED` の根本原因を確認）。
- 実行（本ファイル上記 6項のコマンド）:
  ```bash
  gcloud projects add-iam-policy-binding ai-bridging \
    --member="serviceAccount:649847191589-compute@developer.gserviceaccount.com" \
    --role="roles/datastore.user" --condition=None
  ```
- 付与後確認: `get-iam-policy` で `roles/datastore.user` ← `649847191589-compute@developer.gserviceaccount.com` を確認。
- 注意: Firestore DB は `asia-northeast1`、Cloud Run/Vertex は `us-central1`（越境）。今回は機能成立を確認。レイテンシ最適化は将来課題（ブロッカーではない）。

### 2. DoD #1 — 本番 matchKnownScams が PERMISSION_DENIED を出さない 【達成】

- 本番 `POST /api/judge`（ID トークン付き）で anchor `matchKnownScams` を実行。
- 付与直後（IAM 伝播前）の1回目: `investigation.knownScams = {"status":"error","errorMessage":"7 PERMISSION_DENIED: Missing or insufficient permissions."}`。
- 伝播後（付与から約20秒・リトライ1回目）: `investigation.knownScams = {"status":"ok","matches":[]}`。**PERMISSION_DENIED 解消を確認。** 以降の複数呼び出しでも `status:"ok"` で安定再現。
- **V5（誤読防止・重要）**: `matches:[]`（0件）は正常。`attackPatterns` コレクションが空（書き戻し writer が未実装＝PLAN-v2 V1）のため。合格判定は「PERMISSION_DENIED が消えたか」で行い、matches 件数では判定しない。

### 3. DoD #2 — 実ドメイン RDAP 本番取得可否の確定 【達成: 取得可能】

- `checkDomainAge` は `https://rdap.org/domain/<domain>` を fetch（環境非依存・本番も同一エンドポイント）。
- 実コード（`src/tools/checkDomainAge.ts`）を実ドメインで直接実行:
  - `example.com` → `{ok:true, registeredAt:"1995-08-14T04:00:00Z", ageDays:11253}`
  - `google.com` → `{ok:true, registeredAt:"1997-09-15T04:00:00Z", ageDays:10490}`
  - **＝実ドメインで登録日・経過日数を返すことを確認。**
- 本番 egress の確認: 本番 `/api/judge` に `.example`（予約TLD）URL を含む文を投げると `domainAge = {"status":"error","errorMessage":"http_403"}` を受信。**＝本番から rdap.org へ到達し HTTP 応答を受信できている**（http_403 は予約TLDの正常応答。`.test`/`.example` は RDAP 非対応で 403、STATUS §6 記載どおり）。
- 補足（非ブロッカー）: 実ドメインURLを含む本番 `/api/judge` 1〜2回では Gemini ルーターが `checkDomainAge` を選ばないことがあった（ツール選択の非決定性。RDAP/egress/権限の問題ではない）。RDAP 取得可否は上記の直接実行＋本番 egress 確認で確定済み。
- 補足: `urlReputation` は本番で `missing_api_key`（Web Risk 未配線・T1 スコープ外・想定どおり）。`officialAlerts` は `status:"ok"`。

### 4. 結論

- PLAN-v2 T1 の DoD 2件いずれも達成。anchor `matchKnownScams` は本番で degrade しない。実ドメイン RDAP は取得可能。
- 残る本番 degrade は `urlReputation`(Web Risk 未配線・別タスク) のみ。T2 の観測土台としては、anchor が ok で回ることを確認できた。

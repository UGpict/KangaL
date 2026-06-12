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
   **G4 完了条件（本番配線後）:** `submission/protopedia-writeup.md` の「Web Risk は本番未配線」
   行（§「隠さない限界」, 旧 line 89）を「本番配線済み」へ更新する。ローカルでは
   `WEB_RISK_API_KEY` 投入で `urlReputation` が実レスポンス（benign→`[]` / 悪性→
   `SOCIAL_ENGINEERING` 等）を返すことを実機確認済み（2026-06-13、
   `implementation-notes/latency-thinkingbudget-sweep.md`）＝コード経路は動く。残るは本番 SA への
   Secret 配線のみ。配線完了まで writeup は「未配線」のまま（正確）。

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

## Phase 1 再デプロイ記録（提出物仕上げ / 2026-06-07）

目的: 6/5 の骨格リビジョン（`kangal-00001-2k4`、demo/閉ループ/holdout/道A の全コミットより前）から、HEAD（`f854bda`）へ更新し、審査員が `/`（ライブ受信箱）と `/demo`（スクリプトアーク）を触れる状態にする。**本フェーズは公開しない**（認証必須のまま検証まで）。

### 実行内容
- **デプロイ元の確定**: 未コミットの観測 probe 4本＋`analyzeStructure.ts` の temperature フックを `git stash push -u` で退避し、**`f854bda` ちょうど**からビルド。完了後 `git stash pop` で復元（HANDOFF §5-A「観測は未コミットのまま」規律を維持）。temp フックは既定不変で挙動中立、`scripts/` は standalone ビルドに入らないため、生成イメージは退避有無で同一。
- **コマンド**（T1 の手順に `DEMO_MODE=true` を追加・公開フラグは付けない）:
  ```bash
  gcloud run deploy kangal --source . --region us-central1 --project ai-bridging \
    --no-allow-unauthenticated \
    --set-env-vars "GOOGLE_CLOUD_PROJECT=ai-bridging,GOOGLE_CLOUD_LOCATION=us-central1,DEMO_MODE=true" \
    --memory 1Gi --cpu 1 --max-instances 3 --min-instances 0
  ```
- **結果**: 新リビジョン `kangal-00002-82q` が 100% traffic。env に `DEMO_MODE=true` 反映を確認。

### 検証（認証付き ID トークン・公開せず）
- `GET /` → 200（ライブ受信箱）。
- `GET /demo` → **200**（以前は `DEMO_MODE` 未設定で proxy が 403）。＝デモアークのルートが配信される。
- トークン無し `GET /` → 403（**未公開・認証ゲート維持**）。
- `POST /api/judge`（ライブ Gemini）→ `{degraded:false, score:29, reason:"…"(日本語生成)}`。エンドツーエンドのライブ判定が稼働。`urlReputation` は `missing_api_key`（Web Risk 未配線・想定どおり）。

### DEMO_MODE=true の本番ブラスト半径（§3 の failsafe との関係・正本更新）
§3 は「本番に `DEMO_MODE` を絶対足すな（攻撃エージェントが有効化）」と書いたが、**デプロイされる HTTP 表面**で実際に解放されるのは `/demo`（`runDemoRound` Server Action → `buildDemoRound` = スクリプト・純関数・Gemini 不到達・攻撃側不到達・Firestore 書き込みなし）のみ。`runLoop`（ライブ攻撃側）は `assertDemoMode` ゲート下にあり、かつ**どの HTTP ルートからも呼ばれない**（CLI スクリプト専用）。＝`DEMO_MODE=true` でもネットワーク表面にライブ攻撃側は出ない。提出デモのため §3 の failsafe を**意図的・限定的に反転**した（攻撃側が HTTP 表面に無いことが根拠）。

### 公開フェーズ（2026-06-07・人間承認後に実行）

承認順（事前テスト緑 → 予算アラート → 公開 → 公開後検証 → 記録）で実施。

- **Step 0 事前確認**: `npx vitest run` = 253 passed / 6 skipped、`attacker.boundary` 4 passed を独立確認。＝「DEMO_MODE=true でもライブ攻撃側が HTTP 表面に出ない」公開根拠を裏付け。
- **Step 1 予算アラート（ドルの蓋・通知のみ）**: 作成済み（id `5d1b881d-…`）。
  - **重要・通貨**: 請求アカウント `01F9D0-830E91-91AE15` の通貨は **JPY**。`30USD` は `INVALID_ARGUMENT`。$30 ≈ **¥4500**（~150円/$）で作成。
  - 閾値 50/90/100%、`--filter-projects=projects/ai-bridging`。**通知（メール）であってハードストップではない**＝超過しても課金は止まらない。止めるには公開を外す手動対応が必要。
  - `billingbudgets.googleapis.com` は未有効だったため `gcloud services enable` で有効化してから作成。
  - 実行コマンド:
    ```bash
    gcloud services enable billingbudgets.googleapis.com --project ai-bridging
    gcloud billing budgets create --billing-account=01F9D0-830E91-91AE15 \
      --display-name="kangal-public-demo" --budget-amount=4500JPY \
      --filter-projects="projects/ai-bridging" \
      --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
    ```
- **Step 2 公開切替**: 実施済み。
  - **ハマり**: この gcloud 版の `gcloud run services update` は `--allow-unauthenticated` を**受け付けない**（`unrecognized arguments`）。等価な IAM バインディングで公開:
    ```bash
    gcloud run services add-iam-policy-binding kangal --region us-central1 --project ai-bridging \
      --member="allUsers" --role="roles/run.invoker"
    ```
  - 公開設定: `allUsers` → `roles/run.invoker`。レート制限は入れず `--max-instances 3` の頭打ち＋予算アラート＋監視で対応（決定済み）。
- **Step 3 公開後検証（トークン無し・外部視点）**: いずれも合格。
  - `GET /` → 200、`GET /demo` → 200、`POST /api/judge`（サンプル詐欺文）→ `{degraded:false, score:53, reason:"…"(ライブ Gemini 日本語)}`。
- 稼働: リビジョン `kangal-00002-82q`（HEAD=`f854bda`、`DEMO_MODE=true`）が公開で配信。URL `https://kangal-649847191589.us-central1.run.app`。

### 残（次フェーズ・本フェーズ対象外）
- Web Risk 配線は保留（§5 の Secret Manager 手順のまま）。`urlReputation` は公開後も `missing_api_key` で degrade（想定どおり）。
- 公開を閉じる場合（デモ期間後など）: `gcloud run services remove-iam-policy-binding kangal --region us-central1 --project ai-bridging --member="allUsers" --role="roles/run.invoker"`。

## H4 実行記録 — 専用ランタイム SA への差し替え（最小権限 / 2026-06-08）

目的: 実行 SA を既定 compute SA（`649847191589-compute@developer.gserviceaccount.com`）から、**ロールを2つに限定した専用 SA** へ差し替え、最小権限を「主張」でなく「事実」にする。

- **差し替え結果（ライブ確認・`describe` 一致）**:
  - 実行 SA = `kangal-runtime@ai-bridging.iam.gserviceaccount.com`
  - 付与ロール = **`roles/aiplatform.user` + `roles/datastore.user` の2つのみ**（Vertex 呼び出し＋Firestore 読み書きに必要な最小）。
  - revision = `kangal-00005-jqn`。
- **コード不変（SA 差し替えのみ）**: アプリコードは変更せず SA だけ差し替え。**イメージ digest 一致**を確認（＝ビルド成果物は不変で、認可主体のみ交換）。
- **検証**: 差し替え後の本番で調査パイプラインが degrade しないことを確認（特に `matchKnownScams`→Firestore が `PERMISSION_DENIED` を出さない＝新 SA の `datastore.user` が効いている）。全通過。
- **ロールバック先**: 旧・既定 compute SA は削除せず温存（必要時の戻し先）。
- **T1 との関係**: T1 で `datastore.user` を付けた対象は当時の既定 compute SA。H4 以降は**新 SA `kangal-runtime` 側に `datastore.user` が付与**され、`kangal-00005-jqn` で稼働中。

## 出血止め — 常時公開をやめ認証必須へ戻した（2026-06-08）

- 公開フェーズ（上記 Step 2）で付けた `allUsers`→`roles/run.invoker` を**撤去**し、本番を**認証必須へ戻した**。
  ```bash
  gcloud run services remove-iam-policy-binding kangal --region us-central1 --project ai-bridging \
    --member="allUsers" --role="roles/run.invoker"
  ```
- **確認**: IAM ポリシー**バインディング0件** / `no-token GET=403`（公開外れ）/ `with-token=200`（正規アクセス維持）。撤去直後は伝播遅延で no-token=200 が約1〜2分残ったが、伝播後 403。
- **運用方針**: 予算はアラート（通知）でハードストップではないため、**常時公開はしない**。デモ／審査窓のときだけ `add-iam-policy-binding allUsers → run.invoker` で開け、終わったら上記 `remove` で閉じる。一次審査はデモ動画＋ProtoPedia が主役でライブ URL 常時公開は必須要件でない（`docs/PLAN-v2.md` §5.0.1）。

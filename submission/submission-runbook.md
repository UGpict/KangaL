# 提出直前 runbook（人間が手で実行する手順 / KangaL）

**位置づけ**: 本ファイルは**手順の記録のみ**。エージェント自走では実行しない。各ステップは**提出直前にユーザー（人間）が在席して実行**する。出血止め（認証必須）を常時は崩さず、審査窓の間だけ開ける運用（`docs/implementation-notes-deploy.md` の出血止め方針に従う）。

## 固定値（現状）

| 項目 | 値 |
|---|---|
| project | `ai-bridging`（番号 `649847191589`） |
| service / region | `kangal` / `us-central1` |
| 稼働リビジョン | `kangal-00006-4kw`（G4 提出構成・認証必須） |
| 切り戻し先 | `kangal-00005-jqn` |
| 本番 URL | `https://kangal-649847191589.us-central1.run.app` |
| 予算アラート | `kangal-public-demo` ¥4500 / 通知のみ（ハードストップではない） |
| 請求先アカウント | `01F9D0-830E91-91AE15` |

## 0. 事前確認（公開化の前に潰す）

- [x] **C-8 Gmail OAuth（proxy 経由・到達点は確認済み）**: 認証必須のまま IAM を触らず proxy（`gcloud run services proxy kangal --port 8080`）で踏み、`http://localhost:8080/api/gmail/auth` → **consent 通過・認可コード受領・state 往復・redirect_uri 一致・`gmail.readonly` 承認**まで到達を確認済み。ただし callback が本番URL（認証必須）着地で **GFE 403 → アプリ未到達 → トークン交換は proxy 経由では構造的に完走不能と確定**（redirect_uri 本番固定のため localhost に戻らない）。→ `google-oauth-client-secret` の実証は §1（公開後）で行う。
- [ ] テスト中の OAuth 同意画面なら、審査員が触る場合はテストユーザー追加 or 本番公開申請が必要（録画提出なら不要）。

## 1. 公開化（allUsers 付与）と検証

```bash
gcloud run services add-iam-policy-binding kangal --region us-central1 --project ai-bridging \
  --member="allUsers" --role="roles/run.invoker"
```
- [ ] 伝播待ち（1〜2分）後に検証:
  - `curl -s -o /dev/null -w '%{http_code}' https://kangal-649847191589.us-central1.run.app/` → **200**（公開反映。直後は伝播遅延で 403 が残ることあり）
- [ ] **審査員動線の実走**: 公開 URL を**別ブラウザ／シークレットウィンドウ（未ログイン）**で開き、`/`（ライブ受信箱→判定カード）が触れることを確認。サンプル投入で red/green/gray が返るところまで。
- [ ] **Gmail OAuth トークン交換の実証**（`google-oauth-client-secret` の最後の裏取り・§0 で proxy では構造的に不可と確定済み）: 公開後は本番 callback URL がアプリに到達するので、ブラウザで `https://kangal-649847191589.us-central1.run.app/api/gmail/auth` → consent → callback → セッション cookie 確立まで一周。`access_blocked` なら同意画面のテストユーザーに自分のアカウント追加。完走で client_secret が実証され、必要なら writeup の Gmail 記述を「トークン交換まで検証済み」へ更新してよい。

## 2. 予算・監視（公開中だけ目を離さない）

- [ ] 予算アラート `kangal-public-demo`（¥4500）は**通知のみ**。公開中は請求コンソール／メールを監視。
- [ ] 急騰や 503/再起動が見えたら下の手動 kill か締め直し（concurrency 落とす／`2Gi` へ）を検討。1Gi × concurrency=8 は OOM 余地あり。

## 3. 手動 kill（撤収・閉じる）

審査窓が終わったら**必ず閉じる**（常時公開しない）:
```bash
gcloud run services remove-iam-policy-binding kangal --region us-central1 --project ai-bridging \
  --member="allUsers" --role="roles/run.invoker"
```
- [ ] 検証: IAM バインディング 0件 ／ no-token `GET=403`（伝播後）。

緊急停止（トラフィックを切る）が要るなら切り戻しと同型で旧リビジョンへ寄せる、もしくは `--min-instances 0` 維持でアイドル化。

## 4. 切り戻し（デプロイ起因の不具合時）

```bash
gcloud run services update-traffic kangal --to-revisions kangal-00005-jqn=100 --region us-central1 --project ai-bridging
```

## 5. リポジトリ公開（提出に含めるなら）

- [ ] 公開前チェック: `.env*` / `*.pem` / `*-service-account.json` が tracked でないこと（`.gitignore`／`.dockerignore` 済みだが最終目視）。
- [ ] probe/観測スクリプト（`scripts/probe*`）や `analyzeStructure.ts` の一時フックが混ざっていないこと。
- [ ] 実在機関名・実鍵・完成詐欺文面が履歴に無いこと（道B／実在名禁止／鍵秘匿）。
- [ ] 公開操作（remote 作成・push・visibility 変更）は人間が実行。

## チェックリスト要約（提出当日の順序）

1. C-8 往復（§0）→ writeup Gmail 記述を確定
2. allUsers 付与（§1）→ 200 確認 → 未ログインで審査員動線実走
3. 監視オン（§2）
4. （提出物確定後）リポジトリ公開（§5）
5. 審査窓が終わったら allUsers 撤去（§3）→ 403 確認

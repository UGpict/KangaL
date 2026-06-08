# セッション1 手順書 — 出血止め（常時公開をやめる＝allUsers 撤去）

作成: 2026-06-08 / 修正: 2026-06-08（1a を H4 完了済みに訂正・1c Cloudflare を後段へ格下げ）
位置づけ: `docs/PLAN-v2.md` §5 で固定したセキュリティ出血止めの**正確な手順書**。
**実行はすべて在席ゲート**。私（Claude）は手順とコマンドを用意するだけで、本番 gcloud / デプロイはユーザーが在席で実行する。

対象本番: project `ai-bridging`、service `kangal`、region `us-central1`、
URL `https://kangal-649847191589.us-central1.run.app`、現 revision `kangal-00005-jqn`。

> ⚠️ 全コマンドは**読んで理解してから1つずつ**実行する。各手順に「事前確認 → 実行 → 事後確認」を付けてある。

---

## 0. 現在地（2026-06-08 ライブ確認）

- **止血完了**: `allUsers` バインディングを撤去し、本番を**認証必須へ戻した**（2026-06-08 実行・確認: `no-token GET=403` / `with-token=200` / IAM バインディング0件）。詳細は §S1 の実行記録。**＝S1 の残務は無し。**
- **1a も完了済み**: 実行 SA は `kangal-runtime@ai-bridging.iam.gserviceaccount.com`（専用・`aiplatform.user`+`datastore.user`）、revision `kangal-00005-jqn`。**H4 で差し替え・ライブ確認済み（`describe` 一致）＝再実行不要**（§2）。
- 予算は**アラート（通知）であってハードストップではない**（超過しても課金は止まらない）。だから止血は露出そのものを消すのが最短・確実だった。

### なぜ Cloudflare(edge) を入れないか（審査フローの結論）

- 一次審査（7/10 提出 → 7/30 発表）は**デモ動画＋ProtoPedia 投稿が主役、ライブ URL は補助**（過去回も3分デモ動画・視覚資料を重視）。
- ＝**ライブ URL の常時公開は一次審査の必須要件ではない**。「常時公開を Cloudflare で守る」のは過剰。
- よって出血止めの本体は **`allUsers` 撤去（認証必須へ戻す）だけ**で足りる。Cloudflare 前段は後段（§3）。

---

## S1. 常時公開をやめる（allUsers バインディング撤去）【実行済み・2026-06-08】

> ✅ **実行記録（2026-06-08・在席実行）**: `remove-iam-policy-binding allUsers` 成功 → IAM ポリシー**バインディング0件**を確認。
> 検証: **no-token GET=403**（公開外れ） / **with-token=200**（正規アクセス維持）。
> 注: 撤去直後は伝播遅延で no-token=200 が約1〜2分残ったが、伝播後に 403 へ。撤去操作自体は最初から成功。
> 以降は手順の保存（再現用）。窓を開けたいときの再公開／再封鎖に使う。

開いたときと対称（`add-iam-policy-binding allUsers → run.invoker` で開けたので、`remove` で閉じる）。
※ 現 gcloud バージョンでは `gcloud run services update --allow-unauthenticated` 系が未対応のため、IAM バインディング操作で対称に行う。

### 事前確認（今 public であることの確認）

```
# トークン無し → 現状 200（= 誰でも叩ける＝出血）。本日この値を実測済み。
curl -s -o /dev/null -w "%{http_code}\n" https://kangal-649847191589.us-central1.run.app/
```

### 実行（auth 必須へ戻す）

```
gcloud run services remove-iam-policy-binding kangal \
  --region us-central1 \
  --project ai-bridging \
  --member="allUsers" \
  --role="roles/run.invoker"
```

### 事後確認（閉じたことの確認）

```
# トークン無し → 403（拒否されるようになった＝止血成功）
curl -s -o /dev/null -w "%{http_code}\n" https://kangal-649847191589.us-central1.run.app/

# トークン有り → 200（正規アクセスは通る）
TOKEN=$(gcloud auth print-identity-token)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  https://kangal-649847191589.us-central1.run.app/
```

**合格条件: no-token=403 かつ with-token=200。** この時点で「誰でも叩ける」露出は消える＝出血止め完了。

> デモ／審査窓で一時的に公開したいときは、`add-iam-policy-binding allUsers → roles/run.invoker` で開け、
> 窓が終わったら本節の `remove` で閉じる（常時公開はしない）。

---

## 2. 1a（専用 SA 差し替え）— H4 で完了済み・再実行不要

参考記録（このセッションでは**実行しない**）。ライブ確認の事実のみ:

- 実行 SA = `kangal-runtime@ai-bridging.iam.gserviceaccount.com`（ロールは `aiplatform.user` + `datastore.user` の2つに限定）。
- revision = `kangal-00005-jqn`。
- 確認コマンド（読み取りのみ・再差し替えではない）:
  ```
  gcloud run services describe kangal \
    --region us-central1 --project ai-bridging \
    --format="value(status.latestReadyRevisionName, spec.template.spec.serviceAccountName)"
  # → kangal-00005-jqn    kangal-runtime@ai-bridging.iam.gserviceaccount.com
  ```
- T1（Firestore 権限）はここに合流済み: `datastore.user` は**新 SA `kangal-runtime` に付与**され、`kangal-00005-jqn` で稼働中。

> ＝既定 compute SA はもう実行 SA ではない。writeup の「最小権限 SA」は**事実**として書いてよい（ロール2つに限定）。

---

## ④ 言葉の修正（順序非依存・コストゼロ）

writeup/トークの表現を実態へ:

- 「予算ハードストップ」→ **禁止**。正: 「予算**アラート（通知）**。超過しても課金は自動停止しない」。
- 「最小権限 SA で運用」→ **OK（H4 完了済み）**。`kangal-runtime` がロール2つ（`aiplatform.user`/`datastore.user`）に限定、と併記。
- レート制限の有無は現状（無し）に合わせる。Cloudflare 前段は未導入と明記。

---

## 3. 後段（このセッションではやらない）

- **Cloudflare 前段**（リバースプロキシ＋per-IP レート制限/Turnstile＋origin lockdown）:
  **一次審査の止血には不要**（§0）。常時公開デモを決勝（8/19）で見せたい場合 or 提出後に余裕ができた場合の後段タスク。
- **1b 本物 killswitch**（予算→PubSub→IAM revoke の粗いバックストップ）:
  後段・慎重。**決勝に近い時期に半テストの自動剥奪器をデプロイしない**（PLAN-v2 §5.1）。
- **`firebase.json`**: 保留。`firestore.rules` のリポジトリ固定（本番で `if false` 確認済み）とセットで後でまとめて作る。単体では宙ぶらりん。

---

## 在席ゲート（厳守）

- 本書のコマンドは**ユーザーが在席で実行**。私は手順・コマンドの用意まで。
- 本番反映（gcloud / デプロイ / OAuth 同意画面）は私からは実行しない。
- 読み取り専用の確認（no-token curl / `describe`）は実態把握のため私が実行することがある（mutation は伴わない）。

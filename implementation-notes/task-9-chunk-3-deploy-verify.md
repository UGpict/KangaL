# Task 9 チャンク3: 本番再デプロイ ＋ 公開URL 実機確認

実施日: 2026-06-07

チャンク1〜3（KangaL Design Principles 実装）を載せた HEAD を本番へ再デプロイし、
公開URL（トークン不要）で実機確認した。最重要は **userVerdicts への本番初の
Firestore 書き込み**の可否。

## 再デプロイ

- **ビルド元コミット**: `03ff9f0`（チャンク1〜3を 883d631 の上に1コミット）
  - 直前に vitest 266 passed / 6 skipped・`tsc --noEmit` エラーなし・lint 0 errors を再確認。
- **作法**: Phase 1 と同一。`git stash push -u` で temp フック（analyzeStructure.ts の
  中立 temperature・+7行）と観測 probe 4本を退避し、**クリーンな HEAD ちょうど**から
  ビルド。完了後 `git stash pop` で復元（HANDOFF §5-A の観測未コミット規律を維持）。
- **コマンド**（Phase 1 と同一・`--no-allow-unauthenticated` は付けない＝既に公開済み）:
  ```
  gcloud run deploy kangal --source . --region us-central1 --project ai-bridging \
    --set-env-vars "GOOGLE_CLOUD_PROJECT=ai-bridging,GOOGLE_CLOUD_LOCATION=us-central1,DEMO_MODE=true" \
    --memory 1Gi --cpu 1 --max-instances 3 --min-instances 0
  ```
- **新リビジョン**: `kangal-00003-ttw`（100% トラフィック・正常終了 exit 0）
- **公開URL**: https://kangal-649847191589.us-central1.run.app
- 変更点はリビジョン載せ替えのみ。公開設定（allUsers）・予算アラート・Firestore
  (default)/asia-northeast1・Web Risk 不採用は Phase 1 のまま（再操作なし）。

## 実機確認（公開URL・トークン不要）

### 4. 逃げ道の往復 ＝ userVerdicts 本番書き込み（最重要・本番初）
API レベルで往復を完全実証。**本番 SA で userVerdicts へ書けることを確認**。

| 手順 | リクエスト | 結果 |
|---|---|---|
| 初期 | `GET /api/feedback` | `200 {"verdicts":{}}`（Firestore 到達・空） |
| 書込 | `POST {id:msg-003, decision:marked_safe}` | `200 {"ok":true}` ← **本番初の書き込み成功** |
| 復元 | `GET /api/feedback` | `{"verdicts":{"msg-003":"marked_safe"}}` |
| 取消 | `POST {id:msg-003, decision:null}` | `200 {"ok":true}` |
| 確認 | `GET /api/feedback` | `{"verdicts":{}}`（doc 削除＝取り消し） |
| 拒否 | `POST {id:msg-xxx, ...}` | `400`（未知 ID・コレクション汚染防止） |
| 拒否 | `POST {id:msg-003, decision:approve}` | `400`（不正 decision） |

→ **本番 SA（compute・roles/datastore.user）で userVerdicts への書き込み・読み出し・
削除すべて成功**。バリデーション（未知ID／不正decision の 400）も本番で発火。

### 1–2. 判定カード（赤／緑）
- `POST /api/judge`（詐欺寄りサンプル・spf/dkim/dmarc=fail）が本番で **200・
  `degraded:false`・score・Gemini 生成の理由文**を返すことを実証（Vertex/Gemini 稼働）。
- 判定カードの DOM（赤/緑の結論文・確信度・根拠折りたたみ・報告/安全だと判断ボタン）は
  `"use client"` のクライアント描画。型/テスト/build で静的担保済み。
  ライブ DOM（ボタン押下→カード遷移のビジュアル）は本ヘッドレス環境では未確認。

### 3. degraded の発火
- 本番 investigation で **部分 degrade を実証**: `urlReputation = error/missing_api_key`
  （Web Risk 未投入・ユーザー予測通り）、`domainAge = error/http_403`（RDAP 403）。
  senderAuth は ok（fail 検出 +8）。
- 部分エラーは investigation 内に正直に現れるが、判定自体は score を返す（完全
  degraded カードは analyzeStructure が degrade した時＝Gemini タイムアウト等のみ）。
- 完全 degraded カードの「安全と誤読させない」灰表示の文面は静的担保。今回は未発火。

### 5. ブランド（navy+cyan）・受信箱マーカー
- ルート SSR HTML に `--brand-navy` / `--brand-accent` / 「Kanga**L**」の L 差し色 span・
  サンプル一覧（msg-003 subject）が含まれることを確認。
- `risk-danger` / `risk-degraded` マーカーは**初期 HTML に無い**＝未判定は印なし
  （設計通り：フリクションは危険側に集中・判定後にクライアントで描画）。判定後の
  赤点/灰点描画は型/テストで静的担保。

## 結論
- 再デプロイ成功（`03ff9f0` → `kangal-00003-ttw`・100%）。
- **userVerdicts 本番書き込みは可（本番初・往復＋取り消し＋バリデーション全通過）**。
- judge は本番稼働、部分 degrade（urlReputation/domainAge）を実物で確認。
- ブランド/サンプルの SSR を確認。判定カードと受信箱マーカーの**ライブ DOM 描画のみ
  ヘッドレス環境のため未確認**（静的に担保）。

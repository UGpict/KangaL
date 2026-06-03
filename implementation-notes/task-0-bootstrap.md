# Task 0 — プロジェクト初期化

実施日: 2026-06-03

## 何を
- `C:\Users\zeak2\hackathon` 直下を Next.js (TS / App Router / Tailwind / src ディレクトリ / Turbopack) のプロジェクトルートとして初期化。
- 規約ディレクトリ `src/types`, `src/agents`, `src/tools`, `src/lib` を作成（各 `.gitkeep` 入り）。
- `src/app/page.tsx` を最小化し、`<h1>KangaL</h1>` のみ表示。
- `implementation-notes/` ディレクトリを作成。
- `docs/design-v0.1.md`（v0.4 内容）をプロジェクトルートに退避済み。

## なぜ
- 設計ドキュメント §4（技術スタック）と CLAUDE.md の固定スタックに合わせるため。
- `src/types`, `src/agents`, `src/tools`, `src/lib` は CLAUDE.md と §6 の構成前提（型・エージェント・調査ツール・ライブラリ分離）に直結。骨格をいま揃えておくと後タスクで迷わない。
- `implementation-notes/` は CLAUDE.md「進め方」で各タスク後に残すことが規約化されている。
- 最小 `<h1>KangaL</h1>` のみにしたのは Task 0 のスコープ「機能実装は一切しない。骨格と起動確認だけ」に厳密に従うため。デザインや i18n はあえて入れない。

## どう
1. **既存 `kangal/` の整理**: `create-next-app` が `kangal/` をコンフリクト扱いしたため、`kangal/docs/design-v0.1.md` を `hackathon/docs/` に退避してから `kangal/` を削除。設計ドキュメントの原本は失っていない。
2. **生成コマンド**:
   `npx --yes create-next-app@latest . --typescript --eslint --tailwind --src-dir --app --turbopack --import-alias "@/*" --use-npm`
   - 生成テンプレ: `app-tw`（App Router + Tailwind）
   - 自動生成された `AGENTS.md` がルートに残っている（今後どう扱うかは別途判断）
3. **page.tsx 最小化**: 生成されたサンプル（Next.js ロゴ・Templates/Learn リンク・Deploy ボタン）を全て削除し、`<h1>KangaL</h1>` のみに。
4. **起動確認**: `npm run dev` をバックグラウンドで起動 → `Invoke-WebRequest http://localhost:3000` → HTML に `<h1>KangaL</h1>` が含まれることを確認 → Turbopack でコールドスタート ~1秒 → ポート3000のリスナーを `taskkill /F /T` で停止。

## ハマったところ / 注意
- **`docs/` フォルダ衝突問題**: `create-next-app` は `docs/` を許可済みディレクトリ扱いするので、退避先を `docs/` にしても conflict にならなかった。
- **サンドボックスで Start-Process が EPERM**: `Start-Process` での子プロセス起動はサンドボックスに弾かれた。ツールの `run_in_background` 経由で起動 → `Get-NetTCPConnection -LocalPort 3000` で PID を引いて `taskkill /F /T` で停止、の流れに変更した。次回も同じ手で行ける。
- **`<title>` はテンプレ既定の "Create Next App" のまま**: Task 0 のスコープ外なので未変更。後続タスクで KangaL に差し替える想定。

## 確認した完了条件
- [x] `src/types`, `src/agents`, `src/tools`, `src/lib`, `app/`（実体は `src/app/`）が存在
- [x] `npm run dev` が起動し、トップページに "KangaL" と表示される
- [x] `implementation-notes/` ディレクトリを作成

## やらなかったこと（Task 0 のスコープ外として意図的に保留）
- ADK / Gemini / Firestore / Web Risk / RDAP の接続コード・依存追加
- `src/types/attackPattern.ts` の型定義（Task 1 以降で設計 §5 から起こす）
- `<title>` / ファビコン / メタデータの差し替え
- 倫理声明・README の中身（§9 で「README＋アプリ内＋デモ冒頭末尾」と規約化されているが Task 0 のスコープ外）

## 次タスクへの申し送り
- 設計ドキュメント正本は `docs/design-v0.1.md`（ファイル名は v0.1 だが内容は v0.4）。AttackPattern の enum 正本もここ §5。
- `AGENTS.md`（create-next-app 自動生成）を残すか消すかは次タスク開始時に決める。
- §13 未決のうち「良性サンプルセット調達」は FPR 測定の前提なので、メトリクス UI の前に着手する必要がある。

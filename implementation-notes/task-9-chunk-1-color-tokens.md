# Task 9 チャンク1: リスク状態色のトークン化 ＋ amber（中間帯）除去

実施日: 2026-06-07

KangaL Design Principles の落とし込み（3チャンク構成）の土台。状態色を
globals.css のトークンとして単一の真実源で宣言し、UI の状態色を **3値（赤=danger /
緑=safe / 灰=degraded）で確定**した。中間帯 amber は状態色から外した。

## 追加・変更ファイル
- `src/app/globals.css`（変更）— `:root` にリスク状態色トークン（`--risk-danger`
  / `--risk-safe` / `--risk-degraded`）と未使用の `--risk-caution`、ブランド色
  `--brand-navy` / `--brand-accent` を新設。`--color-brand`（メトリクス recall）が
  ブランド色と別物である旨のコメントを追記。
- `src/components/InboxApp.tsx`（変更）— `RiskColor` から `"amber"` を除去。
  `riskBandFromScore` を 70 閾値の2分岐に（amber 分岐削除）。`BADGE_STYLES` /
  `cardBorder` を3状態のみに。

## 状態色トークンの配線状況（明示）
チャンク1時点で `--risk-danger/-safe/-degraded`（および未使用の `--risk-caution`）と
`--brand-navy/-accent` は **globals.css に定義済み・UI には未配線**。実際の描画は引き続き
InboxApp の Tailwind パレットクラスが担う。**var への完全配線は navy+cyan 適用と同時に
チャンク3で実施**（camera 圧縮耐性の多階調コントラストを一度に作り直すため）。

## 決定（ユーザー確定事項の反映）
- **amber = A（3状態で確定）**。UI・凡例・判定カードに中間帯を出さない。発火しない
  amber 分岐をコードに残さない。
- `--risk-caution` の**トークン定義は残す**が「現状未使用・将来 FPR 実測後に確信度
  バンドとして復活予定」のコメントを1行付与。
- ブランド色 navy+cyan は状態色から**完全分離**。トークンは新設したが**適用は
  チャンク3**（このチャンクでは器のみ）。

## 設計判断

### 1. 30〜69 の帯は safe(緑) に畳む
amber 除去に伴い、旧「中」帯（30〜69）は `score >= 70` 未満として safe へ。fixture が
中間帯を発火させない前提（設計指針の議論）に基づく。一律でない警告は alert fatigue の
素、という指針の方針とも整合。

### 2. BADGE_STYLES / cardBorder は当面 Tailwind 多階調クラスを維持（var 完全配線はチャンク3）
状態色トークンは globals.css で宣言したが、バッジ/カードの実描画は既存の Tailwind
パレット（red-100/900/400/300 等）を据え置いた。理由は **camera 圧縮耐性のために調整
された多階調コントラストを崩さない**ため（slate を emerald と明確に差をつける既存配慮を
含む）。完全な var 配線は、どのみち色を navy+cyan 系へ作り直すチャンク3でまとめて行う。
これによりチャンク1は「amber 除去」以外は**振る舞い不変**を保ち、回帰を見やすくした。

### 3. メトリクスの `--color-brand` はリネームしない
`@theme inline` の `--color-brand`（青・recall 折れ線）は demo 配下6ファイルが
`bg-brand` 等で参照しており、リネームは波及が大きくこのチャンクの趣旨（低リスクな土台）
から外れる。KangaL ブランド色は別名 `--brand-navy` / `--brand-accent` で名前空間を分け、
コメントで両者が別物である旨を明記して衝突を解消した。

## 検証
- `npx tsc --noEmit`: エラーなし
- `npx vitest run`: 253 passed / 6 skipped（amber/riskBand を参照するテストは存在せず、
  変更は InboxApp.tsx 内に閉じる）

## 次（チャンク2）
判定カードを「結論1行 → 理由 → 根拠（折りたたみ）→ 次の一手」に再構成。調査結果を
`<details>` で畳み、「報告する／安全だと判断する」ボタン（逃げ道）を追加。

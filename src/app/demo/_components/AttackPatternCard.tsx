import type { AttackPattern } from "@/types/attackPattern";

// 攻撃型（AttackPattern）の 6 レバー・系統・channel・sourceContext を 1 枚のカードで
// 可視化する純表示コンポーネント（"use client" 不要）。
// 色は役割トークンのみ: gen=brand / channel・intensity=action / fallback=warning /
// それ以外は foreground 中立（ハードコード色禁止）。

export interface AttackPatternCardProps {
  pattern: AttackPattern;
  generation: number;
}

// レバー名の表示ラベル（日本語）。
const LEVER_LABELS = {
  urgency: "緊急性",
  authority: "権威",
  incentive: "誘因",
  callToAction: "誘導",
  personalization: "個人化",
  isolation: "孤立化",
} as const;

// intensity（0〜3）を 3 ドットで表現。立っている分だけ action 色、空きは中立。
function IntensityDots({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(3, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-1" aria-label={`強度 ${filled}/3`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${
            i <= filled ? "bg-action" : "bg-foreground/15"
          }`}
        />
      ))}
      <span className="ml-1 text-xs tabular-nums text-foreground/50">
        {filled}/3
      </span>
    </span>
  );
}

// categorical 値のチップ列。空配列なら「なし」を中立色で出す（欠損/ゼロ値耐性）。
function Chips({ items }: { items: readonly string[] }) {
  if (items.length === 0) {
    return <span className="text-xs text-foreground/40">なし</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((it) => (
        <span
          key={it}
          className="rounded border border-foreground/15 px-1.5 py-0.5 text-xs break-all text-foreground/80"
        >
          {it}
        </span>
      ))}
    </span>
  );
}

// 1 レバー行: 左にラベル、右に内容（テキスト or 強度ドット）。
function LeverRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-foreground/55">
        {label}
      </span>
      <div className="min-w-0 text-right text-sm">{children}</div>
    </div>
  );
}

// categorical 値の素のテキスト（enum 値をそのまま）。長文でも折り返す。
function Value({ children }: { children: React.ReactNode }) {
  return <span className="break-words text-foreground">{children}</span>;
}

export default function AttackPatternCard({
  pattern,
  generation,
}: AttackPatternCardProps) {
  const { levers, channel, sourceContext, parentId } = pattern;
  const isFallback = sourceContext.includes("fallback-seed");

  return (
    <article className="rounded-lg border border-foreground/15 bg-background p-4">
      {/* ── ヘッダ: gen / 系統 / channel ── */}
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-sm font-bold text-brand">
          Gen {generation}
        </span>
        {parentId ? (
          <span
            className="text-xs text-foreground/50"
            title={`parentId: ${parentId}`}
          >
            ← Gen {Math.max(1, generation - 1)}
          </span>
        ) : null}
        <span className="ml-auto rounded-full bg-action/10 px-2.5 py-0.5 text-xs font-semibold text-action break-all">
          {channel}
        </span>
      </header>

      {/* ── sourceContext（fallback-seed は warning） ── */}
      <div className="mb-3">
        {isFallback ? (
          <span className="inline-block rounded bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
            縮退: {sourceContext}
          </span>
        ) : (
          <span className="text-xs text-foreground/55 break-words">
            {sourceContext}
          </span>
        )}
      </div>

      {/* ── 6 レバー ── */}
      <div className="divide-y divide-foreground/10">
        <LeverRow label={LEVER_LABELS.urgency}>
          <div className="flex flex-col items-end gap-1">
            <Value>{levers.urgency.tactic}</Value>
            <IntensityDots value={levers.urgency.intensity} />
          </div>
        </LeverRow>

        <LeverRow label={LEVER_LABELS.authority}>
          <div className="flex flex-col items-end gap-1">
            <Value>{levers.authority.impersonates}</Value>
            <Chips items={levers.authority.credibilityTricks} />
          </div>
        </LeverRow>

        <LeverRow label={LEVER_LABELS.incentive}>
          <div className="flex flex-col items-end gap-1">
            <Value>
              {levers.incentive.type} / {levers.incentive.hook}
            </Value>
            <IntensityDots value={levers.incentive.intensity} />
          </div>
        </LeverRow>

        <LeverRow label={LEVER_LABELS.callToAction}>
          <Value>
            {levers.callToAction.action}
            <span className="text-foreground/50">
              {" "}
              (friction: {levers.callToAction.friction})
            </span>
          </Value>
        </LeverRow>

        <LeverRow label={LEVER_LABELS.personalization}>
          <div className="flex flex-col items-end gap-1">
            <Value>{levers.personalization.level}</Value>
            <Chips items={levers.personalization.signals} />
          </div>
        </LeverRow>

        <LeverRow label={LEVER_LABELS.isolation}>
          <div className="flex flex-col items-end gap-1">
            <Value>{levers.isolation.tactic}</Value>
            <IntensityDots value={levers.isolation.intensity} />
          </div>
        </LeverRow>
      </div>
    </article>
  );
}

// 単独確認用モック（実データ接続は Task 8-C3）。系統あり・全レバー充填の例。
export const MOCK_ATTACK_PATTERN: AttackPattern = {
  id: "demo-gen2",
  generation: 2,
  parentId: "demo-gen1",
  sourceContext: "recon:financial,government",
  channel: "email",
  levers: {
    urgency: { tactic: "deadline", intensity: 2 },
    authority: {
      impersonates: "financial",
      credibilityTricks: ["formal_tone", "url_lookalike"],
    },
    incentive: { type: "fear", hook: "account_loss", intensity: 3 },
    callToAction: { action: "click_link", friction: "low" },
    personalization: { level: "targeted", signals: ["real_name", "thread_injection"] },
    isolation: { tactic: "secrecy", intensity: 1 },
  },
};

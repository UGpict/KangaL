"use client";

import { useEffect, useRef, useState } from "react";
import type { JudgeResponseBody } from "@/app/api/judge/route";
import { SAMPLE_MESSAGES, type InboxMessage } from "@/lib/sampleMessages";
import { summarizeBonus } from "@/lib/weights";
import type {
  BonusSource,
  InvestigationBonus,
  InvestigationReport,
} from "@/types/investigation";

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: JudgeResponseBody }
  | { kind: "error"; message: string };

type RiskColor = "red" | "amber" | "emerald" | "slate";

// Color thresholds: 70 / 30 split. amber is reserved for the medium band and
// is NOT reused anywhere else in the UI (1色1意味 / state-color contract).
function riskBandFromScore(score: number): { label: string; color: RiskColor } {
  if (score >= 70) return { label: "高", color: "red" };
  if (score >= 30) return { label: "中", color: "amber" };
  return { label: "低", color: "emerald" };
}

const BADGE_STYLES: Record<RiskColor, string> = {
  red: "bg-red-100 text-red-900 border-red-400 ring-red-300",
  amber: "bg-amber-100 text-amber-900 border-amber-400 ring-amber-300",
  emerald: "bg-emerald-100 text-emerald-900 border-emerald-400 ring-emerald-300",
  // slate kept clearly distinct from emerald to survive camera compression
  slate: "bg-slate-200 text-slate-800 border-slate-500 ring-slate-400",
};

function RiskBadge({
  label,
  score,
  color,
}: {
  label: string;
  score?: number;
  color: RiskColor;
}) {
  return (
    <span
      className={`inline-flex items-center gap-3 rounded-full border-2 px-5 py-1.5 text-sm font-semibold ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 ${BADGE_STYLES[color]}`}
    >
      <span>{label}</span>
      {typeof score === "number" && (
        <span className="text-xl font-bold tabular-nums">{score}</span>
      )}
    </span>
  );
}

export default function InboxApp() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, JudgeResponseBody>>({});
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const verdictRef = useRef<HTMLDivElement | null>(null);

  const selected: InboxMessage | undefined = SAMPLE_MESSAGES.find(
    (m) => m.id === selectedId,
  );

  async function selectMessage(message: InboxMessage) {
    setSelectedId(message.id);
    const cached = cache[message.id];
    if (cached) {
      setState({ kind: "ok", data: cached });
      return;
    }
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.body,
          authenticationResults: message.authenticationResults,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const errKey =
          typeof body?.error === "string" ? body.error : `${response.status}`;
        throw new Error(errKey);
      }
      const data = (await response.json()) as JudgeResponseBody;
      setCache((prev) => ({ ...prev, [message.id]: data }));
      setState({ kind: "ok", data });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  // Smooth-scroll the verdict card into view when it appears.
  useEffect(() => {
    if (state.kind === "ok" || state.kind === "error") {
      verdictRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [state.kind, selectedId]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-bold tracking-tight">KangaL</h1>
        <p className="text-xs text-zinc-500">進化して、詐欺に食らいつく。</p>
      </header>

      <main className="grid h-[calc(100vh-64px)] grid-cols-1 lg:grid-cols-[340px_1fr]">
        <aside className="overflow-y-auto border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800">
            受信箱
          </div>
          <ul>
            {SAMPLE_MESSAGES.map((m) => {
              const isSelected = m.id === selectedId;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => selectMessage(m)}
                    className={`w-full border-b border-zinc-100 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800 ${
                      isSelected
                        ? "bg-zinc-100 dark:bg-zinc-800"
                        : "bg-transparent"
                    }`}
                  >
                    <div className="truncate text-xs text-zinc-500">
                      {m.from}
                    </div>
                    <div className="mt-0.5 truncate text-sm font-medium">
                      {m.subject}
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
                      {m.body.replace(/\s+/g, " ").slice(0, 60)}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="overflow-y-auto px-6 py-5">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-400">
              左の受信箱からメッセージを選んでください
            </div>
          ) : (
            <article className="mx-auto max-w-3xl">
              <div className="mb-4 space-y-1">
                <div className="text-xs text-zinc-500">
                  受信: {selected.receivedAt}
                </div>
                <div className="text-sm text-zinc-700 dark:text-zinc-300">
                  {selected.from}
                </div>
                <h2 className="text-lg font-bold leading-snug">
                  {selected.subject}
                </h2>
              </div>

              <div className="mb-6 max-h-[38vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-4 text-sm leading-7 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                {selected.body}
              </div>

              <div ref={verdictRef}>
                {state.kind === "loading" && (
                  <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-400" />
                      判定中...
                    </span>
                  </div>
                )}
                {state.kind === "error" && (
                  <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                    <div className="mb-2 font-semibold">判定エラー</div>
                    <p className="text-zinc-600 dark:text-zinc-400">
                      通信または解析に失敗しました ({state.message})。
                    </p>
                    <button
                      type="button"
                      onClick={() => selected && selectMessage(selected)}
                      className="mt-3 rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      再試行
                    </button>
                  </div>
                )}
                {state.kind === "ok" && (
                  <VerdictCard
                    key={selectedId ?? ""}
                    result={state.data}
                  />
                )}
              </div>
            </article>
          )}
        </section>
      </main>
    </div>
  );
}

function VerdictCard({ result }: { result: JudgeResponseBody }) {
  if (result.degraded) {
    return (
      <div className="verdict-pop rounded-lg border-2 border-slate-400 bg-slate-50 p-5 shadow-md dark:bg-slate-900/40">
        <div className="flex items-baseline gap-3">
          <RiskBadge label="判定保留" color="slate" />
        </div>
        <p className="mt-4 text-sm leading-7 text-slate-800 dark:text-slate-200">
          メッセージの構造を分析できませんでした。文面をご確認の上、十分に注意してください。
        </p>
      </div>
    );
  }
  const { label, color } = riskBandFromScore(result.score);
  const cardBorder: Record<RiskColor, string> = {
    red: "border-red-300 bg-red-50/60 dark:bg-red-950/30",
    amber: "border-amber-300 bg-amber-50/60 dark:bg-amber-950/30",
    emerald: "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30",
    slate: "border-slate-300 bg-slate-50 dark:bg-slate-900/40",
  };
  return (
    <div
      className={`verdict-pop rounded-lg border-2 p-5 shadow-md ${cardBorder[color]}`}
    >
      <div className="flex items-baseline gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          危険度
        </span>
        <RiskBadge label={label} score={result.score} color={color} />
        <span className="text-xs text-zinc-500">/100</span>
      </div>
      <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-zinc-800 dark:text-zinc-200">
        {result.reason}
      </p>
      {result.isolationNote && (
        <div className="mt-5 rounded border-l-4 border-l-red-500 border border-red-200 bg-red-50 px-4 py-3 text-sm leading-7 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider">
            注記
          </div>
          <p className="whitespace-pre-wrap">{result.isolationNote}</p>
        </div>
      )}
      <InvestigationSection
        investigation={result.investigation}
        bonus={result.investigationBonus}
      />
    </div>
  );
}

// Concise summary string for each tool finding. Keeps emojis off the
// status-color palette (neutral zinc only, per Chunk 5 spec) and degrades
// gracefully on missing data / long strings.
type ToolRow = {
  source: BonusSource;
  emoji: string;
  label: string;
  summary: string;
};

function rowsFromInvestigation(report: InvestigationReport): ToolRow[] {
  const rows: ToolRow[] = [];

  if (report.urlReputation) {
    const f = report.urlReputation;
    let summary: string;
    if (f.status === "ok") {
      summary = (f.threats?.length ?? 0) > 0
        ? `${f.threats!.join(", ")} を検出`
        : "脅威なし";
    } else {
      summary = `判定不可 (${f.errorMessage ?? "unknown"})`;
    }
    rows.push({ source: "webRisk", emoji: "🌐", label: "Web Risk", summary });
  }

  if (report.domainAge) {
    const f = report.domainAge;
    let summary: string;
    if (f.status === "ok") {
      const days = typeof f.ageDays === "number" ? `${f.ageDays} 日` : "不明";
      summary = `登録から ${days}${f.domain ? ` (${f.domain})` : ""}`;
    } else {
      summary = `判定不可 (${f.errorMessage ?? "unknown"})`;
    }
    rows.push({
      source: "domainAge",
      emoji: "📅",
      label: "ドメイン年齢",
      summary,
    });
  }

  if (report.senderAuth) {
    const f = report.senderAuth;
    let summary: string;
    if (f.status === "ok") {
      summary = `SPF=${f.spf ?? "?"} DKIM=${f.dkim ?? "?"} DMARC=${f.dmarc ?? "?"}`;
    } else {
      summary = `判定不可 (${f.errorMessage ?? "unknown"})`;
    }
    rows.push({
      source: "senderAuth",
      emoji: "📧",
      label: "認証",
      summary,
    });
  }

  if (report.knownScams) {
    const f = report.knownScams;
    let summary: string;
    if (f.status === "ok") {
      summary = (f.matches?.length ?? 0) > 0
        ? `${f.matches!.length} 件の類似手口`
        : "該当なし";
    } else {
      summary = `判定不可 (${f.errorMessage ?? "unknown"})`;
    }
    rows.push({
      source: "knownScams",
      emoji: "🔍",
      label: "既知手口",
      summary,
    });
  }

  if (report.officialAlerts) {
    const f = report.officialAlerts;
    let summary: string;
    if (f.status === "ok") {
      summary = (f.matches?.length ?? 0) > 0
        ? `${f.matches!.length} 件の注意喚起`
        : "該当なし";
    } else {
      summary = `判定不可 (${f.errorMessage ?? "unknown"})`;
    }
    rows.push({
      source: "officialAlerts",
      emoji: "📢",
      label: "公的注意喚起",
      summary,
    });
  }

  return rows;
}

function InvestigationSection({
  investigation,
  bonus,
}: {
  investigation: InvestigationReport | null | undefined;
  bonus: InvestigationBonus | undefined;
}) {
  if (!investigation) {
    return (
      <div className="mt-5 rounded border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40">
        調査未実施
      </div>
    );
  }

  const rows = rowsFromInvestigation(investigation);
  if (rows.length === 0 && !investigation.truncated) {
    return null;
  }

  // Map source → bonus points for quick lookup. Missing source ⇒ no points.
  const pointsBySource = new Map<BonusSource, number>(
    (bonus?.items ?? []).map((item) => [item.source, item.points]),
  );
  // M5: surface raw item sum alongside the capped total so a user reading
  // 15+10+8+5+8 in the rows can see why the header says +25.
  const { rawTotal, total, capped } = summarizeBonus(bonus);

  return (
    <div className="mt-5 rounded border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/40">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <span>調査結果</span>
        {total > 0 && (
          <span className="font-mono normal-case tracking-normal text-zinc-700 dark:text-zinc-300">
            +{total}
            {capped ? " (上限到達)" : ""}
          </span>
        )}
        {capped && (
          <span className="font-mono normal-case tracking-normal text-zinc-500">
            素点合計: {rawTotal} / 反映: {total}
          </span>
        )}
      </div>
      {rows.length > 0 && (
        <ul className="space-y-1.5 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          {rows.map((row) => {
            const points = pointsBySource.get(row.source);
            return (
              <li
                key={row.source}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
              >
                <span aria-hidden className="text-base leading-none">
                  {row.emoji}
                </span>
                <span className="font-medium">{row.label}:</span>
                <span className="min-w-0 flex-1 break-words">
                  {row.summary}
                </span>
                {typeof points === "number" && points > 0 && (
                  <span className="font-mono text-xs text-zinc-500">
                    +{points}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {investigation.truncated && (
        <p
          className={`text-xs text-zinc-500 ${
            rows.length > 0 ? "mt-3" : ""
          }`}
        >
          ※ 調査が時間切れで一部のみ完了しました
        </p>
      )}
    </div>
  );
}

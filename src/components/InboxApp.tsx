"use client";

import { useEffect, useRef, useState } from "react";
import type { JudgeResponseBody } from "@/app/api/judge/route";
import { SAMPLE_MESSAGES, type InboxMessage } from "@/lib/sampleMessages";
import { summarizeBonus } from "@/lib/weights";
import type { UserDecision } from "@/types/feedback";
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

type RiskColor = "red" | "emerald" | "slate";

// 状態色は3値で確定（赤=danger / 緑=safe / 灰=degraded）。中間帯 amber は外した:
// fixture が 30〜69 を発火させず、一律でない警告は alert fatigue の素。70 以上を
// danger、未満を safe とする。将来 FPR 実測後に確信度バンドを復活させる余地は
// globals.css の --risk-caution（未使用）に残してある。
function riskBandFromScore(
  score: number,
): { label: string; color: "red" | "emerald" } {
  if (score >= 70) return { label: "高", color: "red" };
  return { label: "低", color: "emerald" };
}

// 結論（1行）は赤/緑で別文。緑は「安全です」と言い切らず過信を生まないトーンに
// 留める（doc: 強すぎる緑にしない）。断定 ⟷ 不確実性に誠実、の緊張をコピーで体現。
const CONCLUSION: Record<"red" | "emerald", string> = {
  red: "これは詐欺の可能性が高いです",
  emerald: "目立った問題は見つかりませんでした",
};

// 受信箱リストの「開く前/再訪時に分かる印」。視覚的フリクションは危険側に集中させ、
// 安全（緑）は静かに＝印を出さない（doc）。色は globals.css の状態色トークンを参照し、
// 単一の真実源とする。判定前（cache 未保持）は印なし＝まだ判定していないという正直さ。
function listMarker(
  judged: JudgeResponseBody | undefined,
): { color: string; label: string } | null {
  if (!judged) return null;
  if (judged.degraded)
    return { color: "var(--risk-degraded)", label: "判定保留" };
  if (judged.score >= 70) return { color: "var(--risk-danger)", label: "要注意" };
  return null;
}

const BADGE_STYLES: Record<RiskColor, string> = {
  red: "bg-red-100 text-red-900 border-red-400 ring-red-300",
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
  const [decisions, setDecisions] = useState<Record<string, UserDecision>>({});
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const verdictRef = useRef<HTMLDivElement | null>(null);

  // 永続済みの逃げ道（userVerdicts）を起動時に復元。認証なし環境では空で返るので
  // UI は劣化しない。
  useEffect(() => {
    let cancelled = false;
    fetch("/api/feedback")
      .then((r) => (r.ok ? r.json() : { verdicts: {} }))
      .then((d: { verdicts?: Record<string, UserDecision> }) => {
        if (!cancelled && d?.verdicts) setDecisions(d.verdicts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 逃げ道の上書き: 楽観的にローカル反映してから永続化。decision === null は取り消し。
  async function decide(messageId: string, decision: UserDecision | null) {
    setDecisions((prev) => {
      const next = { ...prev };
      if (decision === null) delete next[messageId];
      else next[messageId] = decision;
      return next;
    });
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: messageId, decision }),
      });
    } catch {
      // 楽観的 UI は保持。次の操作で永続を再試行する。
    }
  }

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
      {/* ブランド色 navy+cyan はヘッダーにのみ適用。状態色（赤/緑/灰）とは混ぜない。 */}
      <header
        style={{ backgroundColor: "var(--brand-navy)" }}
        className="border-b border-black/20 px-6 py-3"
      >
        <h1 className="text-xl font-bold tracking-tight text-white">
          Kanga
          <span style={{ color: "var(--brand-accent)" }}>L</span>
        </h1>
        <p className="text-xs text-white/60">進化して、詐欺に食らいつく。</p>
      </header>

      <main className="grid h-[calc(100vh-64px)] grid-cols-1 lg:grid-cols-[340px_1fr]">
        <aside className="overflow-y-auto border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800">
            受信箱
          </div>
          <ul>
            {SAMPLE_MESSAGES.map((m) => {
              const isSelected = m.id === selectedId;
              const marker = listMarker(cache[m.id]);
              const decision = decisions[m.id];
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => selectMessage(m)}
                    className={`flex w-full gap-3 border-b border-zinc-100 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800 ${
                      isSelected
                        ? "bg-zinc-100 dark:bg-zinc-800"
                        : "bg-transparent"
                    }`}
                  >
                    {/* 危険側にだけ点を出す。安全/未判定は透明＝静か。整列は常に保つ。 */}
                    <span
                      aria-label={marker?.label}
                      title={marker?.label}
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={
                        marker ? { backgroundColor: marker.color } : undefined
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-zinc-500">
                        {m.from}
                      </div>
                      <div className="mt-0.5 truncate text-sm font-medium">
                        {m.subject}
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
                        {m.body.replace(/\s+/g, " ").slice(0, 60)}
                      </div>
                      {decision && (
                        <div className="mt-1 text-[10px] font-medium text-zinc-400">
                          {decision === "reported"
                            ? "報告済み"
                            : "安全と判断"}
                        </div>
                      )}
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
                    decision={
                      selectedId ? decisions[selectedId] ?? null : null
                    }
                    onDecide={(d) => selectedId && decide(selectedId, d)}
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

// 「次の一手」= AI 判定への逃げ道（doc: AI判定に上書きを必ず残す）。視覚的
// フリクションは危険側に集中させる: 赤では「報告する」を主（solid）、「安全だと
// 判断する」を従（控えめなテキストリンク）。緑は静かに、灰は正直に単一の報告のみ。
// 状態は親（InboxApp）が持ち、onDecide で楽観的反映＋ /api/feedback へ永続。
function NextSteps({
  color,
  decision,
  onDecide,
}: {
  color: RiskColor;
  decision: UserDecision | null;
  onDecide: (decision: UserDecision | null) => void;
}) {
  if (decision) {
    return (
      <div className="mt-5 flex items-center gap-3 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-700">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          ✓ {decision === "reported" ? "報告しました" : "安全だと判断しました"}
        </span>
        <button
          type="button"
          onClick={() => onDecide(null)}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          取り消す
        </button>
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
      {color === "red" && (
        <>
          <button
            type="button"
            onClick={() => onDecide("reported")}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
          >
            報告する
          </button>
          <button
            type="button"
            onClick={() => onDecide("marked_safe")}
            className="text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            安全だと判断する
          </button>
        </>
      )}
      {color === "emerald" && (
        <button
          type="button"
          onClick={() => onDecide("reported")}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          詐欺かもしれないと報告する
        </button>
      )}
      {color === "slate" && (
        <button
          type="button"
          onClick={() => onDecide("reported")}
          className="rounded-md border border-slate-400 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          報告する
        </button>
      )}
    </div>
  );
}

function VerdictCard({
  result,
  decision,
  onDecide,
}: {
  result: JudgeResponseBody;
  decision: UserDecision | null;
  onDecide: (decision: UserDecision | null) => void;
}) {
  if (result.degraded) {
    return (
      <div className="verdict-pop rounded-lg border-2 border-slate-400 bg-slate-50 p-5 shadow-md dark:bg-slate-900/40">
        <div className="mb-3 flex items-start justify-between gap-4">
          <h3 className="text-lg font-bold leading-snug text-slate-800 dark:text-slate-200">
            判定できませんでした
          </h3>
          <div className="shrink-0 text-right">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              状態
            </div>
            <RiskBadge label="判定保留" color="slate" />
          </div>
        </div>
        <p className="text-sm leading-7 text-slate-800 dark:text-slate-200">
          メッセージの構造を分析できませんでした。これは「安全」という意味ではありません。文面をご確認の上、十分に注意してください。
        </p>
        <NextSteps color="slate" decision={decision} onDecide={onDecide} />
      </div>
    );
  }

  const { label, color } = riskBandFromScore(result.score);
  const cardBorder: Record<RiskColor, string> = {
    red: "border-red-300 bg-red-50/60 dark:bg-red-950/30",
    emerald: "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30",
    slate: "border-slate-300 bg-slate-50 dark:bg-slate-900/40",
  };
  const headlineClass =
    color === "red"
      ? "text-red-900 dark:text-red-200"
      : "text-emerald-900 dark:text-emerald-200";

  return (
    <div
      className={`verdict-pop rounded-lg border-2 p-5 shadow-md ${cardBorder[color]}`}
    >
      {/* 結論（1行・断定）＋ 確信度（score）。doc: 行動可能な洞察を生データより先に。 */}
      <div className="mb-3 flex items-start justify-between gap-4">
        <h3 className={`text-lg font-bold leading-snug ${headlineClass}`}>
          {CONCLUSION[color]}
        </h3>
        <div className="shrink-0 text-right">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            確信度
          </div>
          <RiskBadge label={label} score={result.score} color={color} />
        </div>
      </div>

      {/* 理由（短く・人間語）。技術的な詳細は根拠（折りたたみ）へ。 */}
      <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-800 dark:text-zinc-200">
        {result.reason}
      </p>
      {color === "emerald" && (
        <p className="mt-2 text-xs leading-6 text-zinc-500">
          「絶対に安全」という意味ではありません。心当たりのない送金・連絡の依頼には引き続きご注意ください。
        </p>
      )}

      {/* isolationNote は技術詳細ではなく孤立化への人間語の警告。危険側に残して可視に。 */}
      {result.isolationNote && (
        <div className="mt-4 rounded border border-red-200 border-l-4 border-l-red-500 bg-red-50 px-4 py-3 text-sm leading-7 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider">
            注記
          </div>
          <p className="whitespace-pre-wrap">{result.isolationNote}</p>
        </div>
      )}

      {/* 根拠（段階的開示）— 技術的な調査結果・配点は折りたたみの中へ。 */}
      <details className="mt-4">
        <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300">
          根拠を見る
        </summary>
        <InvestigationSection
          investigation={result.investigation}
          bonus={result.investigationBonus}
        />
      </details>

      <NextSteps color={color} decision={decision} onDecide={onDecide} />
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

// M4 UI: per-reason copy so users can tell "still working" vs "real cap"
// vs "something broke". null = clean exit, no note rendered.
function truncationNote(
  reason: InvestigationReport["truncatedReason"],
): string {
  switch (reason) {
    case "budget":
      return "※ 調査が時間切れで一部のみ完了しました (時間制限)";
    case "max_turns":
      return "※ 調査ステップ上限に到達したため一部のみ完了しました";
    case "error":
      return "※ 調査がエラーで中断しました";
    default:
      return "※ 調査が一部のみ完了しました";
  }
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
          {truncationNote(investigation.truncatedReason)}
        </p>
      )}
    </div>
  );
}

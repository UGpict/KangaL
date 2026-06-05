"use client";

// デモページの対話制御。polling 方式（1ラウンド = 1 Server Action 呼び出し）で攻防ループを
// 1ラウンドずつ進め、ラウンド間に小さな遅延を入れて「承→転→結」が画面で見える（撮れる）
// ように更新する。ラウンド間の状態（累積点・現ラウンド）はこのクライアントが保持し、
// round を引数に runDemoRound を再呼び出しする（Server Action 自体はステートレス）。

import { useCallback, useState } from "react";
import { runDemoRound } from "../actions";
import type { DemoRoundPayload } from "../_loop";
import AttackPatternCard from "./AttackPatternCard";
import DetectionMeter from "./DetectionMeter";
import MetricsChart from "./MetricsChart";
import ToolSelectionLog from "./ToolSelectionLog";

type Status = "idle" | "running" | "done";

// ラウンド間ウェイト（ms）。承転結の遷移を目視/録画できる速さにする。
const ROUND_DELAY_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 開始前/各スロットの空状態プレースホルダ。
function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-foreground/15 p-4 text-sm text-foreground/40">
      {label}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/55">
      {children}
    </h2>
  );
}

export default function DemoController() {
  const [rounds, setRounds] = useState<DemoRoundPayload[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setRounds([]);
    setError(null);
    setStatus("running");
    try {
      let round = 1;
      // done（最終ラウンド）または detected（実ループでは検知で打ち切り）まで進める。
      while (true) {
        const payload = await runDemoRound(round);
        setRounds((prev) => [...prev, payload]);
        if (payload.done || payload.detected) break;
        await sleep(ROUND_DELAY_MS);
        round += 1;
      }
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ループ実行に失敗しました");
      setStatus("idle");
    }
  }, []);

  const current = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const points = rounds.map((r) => r.point);
  // ToolSelectionLog はラウンドでグルーピング表示するため、累積ログを渡して履歴を見せる。
  const logs = rounds.flatMap((r) => r.logs);
  const isRunning = status === "running";

  return (
    <div className="space-y-6">
      {/* ── 操作バー ── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={start}
          disabled={isRunning}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning ? "実行中…" : "ループ開始"}
        </button>

        {current ? (
          <span className="text-sm text-foreground/60 tabular-nums">
            Round {current.round} / {current.totalRounds}
          </span>
        ) : null}

        {status === "running" ? (
          <span className="text-sm text-foreground/50">攻防ループ実行中…</span>
        ) : null}
        {status === "done" ? (
          <span className="text-sm font-semibold text-action">完了</span>
        ) : null}
        {error ? (
          <span className="text-sm font-medium text-warning">{error}</span>
        ) : null}
      </div>

      {/* ── 冒頭/末尾の研究目的声明（倫理声明の補強） ── */}
      {status === "idle" ? (
        <p className="text-sm text-foreground/60">
          これは研究目的のシミュレーションです。「ループ開始」を押すと、攻撃AIが攻撃パターン（型）を
          進化させ、防御AIが検知を試みる攻防を1ラウンドずつ再現します。
        </p>
      ) : null}
      {status === "done" ? (
        <p className="text-sm text-foreground/60">
          研究目的のシミュレーションが完了しました。表示された攻撃パターンは抽象的な型であり、
          実際の詐欺文は生成・保存していません。
        </p>
      ) : null}

      {/* ── 攻撃型カード（現ラウンド） / 検知率メーター ── */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <SectionTitle>攻撃型（現ラウンド）</SectionTitle>
          {current ? (
            <AttackPatternCard
              pattern={current.pattern}
              generation={current.generation}
            />
          ) : (
            <Placeholder label="「ループ開始」を押すと攻撃型が表示されます" />
          )}
        </div>
        <div>
          <SectionTitle>検知率（recall / FPR）</SectionTitle>
          <div className="rounded-lg border border-foreground/15 bg-background p-4">
            {current ? (
              <DetectionMeter recall={current.meter.recall} fpr={current.meter.fpr} />
            ) : (
              <Placeholder label="メトリクス未取得" />
            )}
          </div>
        </div>
      </div>

      {/* ── ツール選択ログ（累積） ── */}
      <div>
        <SectionTitle>調査ツールの選択ログ</SectionTitle>
        <div className="rounded-lg border border-foreground/15 bg-background p-4">
          <ToolSelectionLog logs={logs} />
        </div>
      </div>

      {/* ── メトリクス推移グラフ（全ラウンド） ── */}
      <div>
        <SectionTitle>メトリクス推移（recall / FPR / coverage）</SectionTitle>
        <div className="rounded-lg border border-foreground/15 bg-background p-2">
          {points.length > 0 ? (
            <MetricsChart rounds={points} />
          ) : (
            <Placeholder label="ループ開始でラウンドごとの推移が描画されます" />
          )}
        </div>
      </div>
    </div>
  );
}

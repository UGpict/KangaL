"use client";

// recharts は内部で hooks / DOM（ResponsiveContainer の ResizeObserver 等）を使うため
// Client Component 必須。デモページ（Server Component 想定）からは子として差し込む。
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// グラフが受け取る1ラウンド分の点。
// 注: src/lib/metrics.ts の RoundMetrics（{ recall; fpr }・Ratio=number|null・
// round/coverage 無し）とは別物。グラフは「描画可能な数値（0〜1）」だけを受け取る
// 表示専用の形にしている。lib の集計結果 → この形への変換は実データ接続（Task 8-C3）
// の責務で、ここでは描画契約のみを定義する。
export interface RoundMetricsPoint {
  round: number;
  recall: number;
  fpr: number;
  coverage: number;
}

export interface MetricsChartProps {
  rounds: RoundMetricsPoint[];
  // 折れ線エリアの高さ(px)。幅は ResponsiveContainer が親に追従する。
  height?: number;
  // 余白・背景などを呼び出し側が Tailwind で制御するためのフック。
  className?: string;
}

// 単独確認用のモックデータ（Storybook 相当）。実データ接続は Task 8-C3。
// recall: ギザギザ回復（型が進化するとすり抜けて落ち、防御が追いつくと戻る）。
// fpr:    低位安定（良性ベースラインを誤検知し続けない）。
// coverage: 増加傾向（攻防を重ねるほど守備範囲が広がる）。
export const MOCK_ROUNDS: RoundMetricsPoint[] = [
  { round: 1, recall: 0.2, fpr: 0.1, coverage: 0.3 },
  { round: 2, recall: 0.7, fpr: 0.08, coverage: 0.38 },
  { round: 3, recall: 0.35, fpr: 0.09, coverage: 0.5 },
  { round: 4, recall: 0.8, fpr: 0.06, coverage: 0.62 },
  { round: 5, recall: 0.55, fpr: 0.07, coverage: 0.71 },
  { round: 6, recall: 0.9, fpr: 0.05, coverage: 0.83 },
];

// recall/FPR/coverage の推移を 1 枚の折れ線グラフで可視化する再利用コンポーネント。
// 色は globals.css の役割トークン（var(--color-*)）を参照し、UI 全体と一貫させる。
export default function MetricsChart({
  rounds,
  height = 320,
  className,
}: MetricsChartProps) {
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={rounds}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
          <XAxis
            dataKey="round"
            tickFormatter={(r) => `R${r}`}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={(v) => v.toFixed(2)}
            tick={{ fontSize: 12 }}
            width={40}
          />
          <Tooltip />
          <Legend />
          {/* type="linear": recall の「ギザギザ」をなまさず忠実に見せる。 */}
          <Line
            type="linear"
            dataKey="recall"
            name="recall"
            stroke="var(--color-brand)"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="linear"
            dataKey="fpr"
            name="FPR"
            stroke="var(--color-warning)"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="linear"
            dataKey="coverage"
            name="coverage"
            stroke="var(--color-action)"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

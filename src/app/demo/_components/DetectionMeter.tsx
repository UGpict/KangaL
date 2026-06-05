// recall / FPR を 2 本の数値メーター（progress bar 相当）で表示する純表示コンポーネント。
// hooks・イベント・ブラウザ API を使わないため Server Component（"use client" 不要）。
// 色は globals.css の役割トークンのみ: recall=brand / FPR=warning（ハードコード色禁止）。

export interface DetectionMeterProps {
  recall: number; // 0〜1
  fpr: number; // 0〜1
}

// 0〜1 に丸める。NaN・範囲外・欠損（undefined 経由の NaN）でもバーが壊れないようにする。
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function pct(v: number): string {
  return `${Math.round(clamp01(v) * 100)}%`;
}

// label = 行ラベル、ratio = 0〜1、colorClass = 塗りの役割色（Tailwind theme ユーティリティ）。
function MeterRow({
  label,
  ratio,
  fillClass,
}: {
  label: string;
  ratio: number;
  fillClass: string;
}) {
  const width = pct(ratio);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-foreground/70">{width}</span>
      </div>
      {/* トラックは中立色（foreground 低 opacity）、塗りは役割色。 */}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-foreground/10">
        <div
          className={`h-full rounded-full ${fillClass}`}
          style={{ width }}
          role="progressbar"
          aria-valuenow={Math.round(clamp01(ratio) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        />
      </div>
    </div>
  );
}

export default function DetectionMeter({ recall, fpr }: DetectionMeterProps) {
  return (
    <div className="space-y-3">
      <MeterRow label="recall" ratio={recall} fillClass="bg-brand" />
      <MeterRow label="FPR" ratio={fpr} fillClass="bg-warning" />
    </div>
  );
}

// 単独確認用モック（実データ接続は Task 8-C3）。recall 高め・FPR 低めの典型値。
export const MOCK_DETECTION: DetectionMeterProps = {
  recall: 0.82,
  fpr: 0.06,
};

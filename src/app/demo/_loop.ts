// デモページ用の「攻防ループ」データ層（純粋・テスト可能）。
//
// データ源はスクリプト化シナリオ（ユーザー選択）。実 Gemini/Vertex は呼ばず、
// 承転結アーク（recall ギザギザ→回復）を決定論的に再現する。実型（RoundRecord /
// AttackPattern / InvestigationReport / RoundMetrics）で組むことで、後続で実 runLoop
// に差し替える際の変換コードがそのまま使える（差し替えは buildDemoRound のデータ源を
// runLoop の結果に替えるだけ）。
//
// このファイルには "use server" / "use client" を付けない。理由: "use server" は全
// export を async Server Action にする制約があり、ここで定義する同期の純関数（変換・
// シナリオ）を export できなくなる。Server Action 本体は actions.ts に薄く置き、ロジックは
// すべてこの純粋モジュールに集約してテスト対象にする。

import type { RoundMetrics } from "@/lib/metrics";
import type { AttackPattern } from "@/types/attackPattern";
import type {
  DomainAgeFinding,
  InvestigationReport,
  KnownScamsFinding,
  OfficialAlertsFinding,
  SenderAuthFinding,
  UrlReputationFinding,
} from "@/types/investigation";
import type { DetectionMeterProps } from "./_components/DetectionMeter";
import type { RoundMetricsPoint } from "./_components/MetricsChart";
import type { ToolLogEntry } from "./_components/ToolSelectionLog";

// 1ラウンド分のシナリオ。record は実ループの RoundRecord 相当（loop.ts の型を import
// すると @google/genai 等の実エージェントまで巻き込むため、必要フィールドだけをここで
// 構造的に持つ）。coverage は MetricsChart 用の「守備範囲」値で、RoundMetrics には無い
// ので別供給する（8-C1 メモのとおり coverage 供給は接続側の責務）。
export interface DemoScenarioRound {
  round: number;
  pattern: AttackPattern;
  report: InvestigationReport;
  result: { detected: boolean; score: number };
  metrics: RoundMetrics;
  coverage: number;
}

// クライアントへ返す1ラウンド分のペイロード。Server Action の戻り値はシリアライズ可能で
// なければならないため、すべてプレーンなオブジェクト/配列/文字列・数値・真偽値で構成する。
export interface DemoRoundPayload {
  round: number;
  totalRounds: number;
  pattern: AttackPattern;
  generation: number;
  meter: DetectionMeterProps;
  logs: ToolLogEntry[];
  point: RoundMetricsPoint;
  detected: boolean;
  done: boolean;
}

// ── 変換関数（純粋・テスト対象） ──────────────────────────────────────

// Ratio（number | null）を描画可能な number に落とす。null は「分母なし」を表すが、
// メーター/グラフは数値しか描けないので 0 に倒す（8-C1 メモ: null の扱いは接続側の責務）。
function toNumber(value: number | null): number {
  return value == null ? 0 : value;
}

function urlReputationReason(f: UrlReputationFinding): string {
  if (f.status === "error") return f.errorMessage ?? "URL評価でエラー";
  return f.threats && f.threats.length > 0
    ? `脅威検出: ${f.threats.join(", ")}`
    : "URLは脅威なし";
}

function senderAuthReason(f: SenderAuthFinding): string {
  if (f.status === "error") return f.errorMessage ?? "送信者認証でエラー";
  return `SPF=${f.spf ?? "?"} / DKIM=${f.dkim ?? "?"} / DMARC=${f.dmarc ?? "?"}`;
}

function officialAlertsReason(f: OfficialAlertsFinding): string {
  if (f.status === "error") return f.errorMessage ?? "公式注意喚起の照合でエラー";
  return f.matches && f.matches.length > 0
    ? `公式注意喚起 ${f.matches.length}件に合致`
    : "該当する公式注意喚起なし";
}

function domainAgeReason(f: DomainAgeFinding): string {
  if (f.status === "error") return f.errorMessage ?? "ドメイン年齢の取得でエラー";
  return f.ageDays != null ? `登録から ${f.ageDays}日` : "ドメイン年齢を確認";
}

function knownScamsReason(f: KnownScamsFinding): string {
  if (f.status === "error") return f.errorMessage ?? "既知手口の照合でエラー";
  return f.matches && f.matches.length > 0
    ? `既知手口 ${f.matches.length}件に類似`
    : "既知手口に一致なし";
}

// InvestigationReport → ツール選択ログ。レポートに finding キーが存在すれば「呼び出した」、
// 無ければ「非選択」（動的ルータが呼ばなかったツールはレポートに現れない、という
// investigation.ts の契約に従う）。knownScams を先頭（アンカー）に固定し、5ツールを必ず
// 漏れなく並べることで「何を選び・何を選ばなかったか」を毎ラウンド可視化する。
export function reportToToolLogs(
  report: InvestigationReport,
  round: number,
): ToolLogEntry[] {
  return [
    {
      round,
      toolName: "knownScams",
      called: report.knownScams !== undefined,
      reason: report.knownScams ? knownScamsReason(report.knownScams) : undefined,
    },
    {
      round,
      toolName: "urlReputation",
      called: report.urlReputation !== undefined,
      reason: report.urlReputation
        ? urlReputationReason(report.urlReputation)
        : undefined,
    },
    {
      round,
      toolName: "senderAuth",
      called: report.senderAuth !== undefined,
      reason: report.senderAuth ? senderAuthReason(report.senderAuth) : undefined,
    },
    {
      round,
      toolName: "officialAlerts",
      called: report.officialAlerts !== undefined,
      reason: report.officialAlerts
        ? officialAlertsReason(report.officialAlerts)
        : undefined,
    },
    {
      round,
      toolName: "domainAge",
      called: report.domainAge !== undefined,
      reason: report.domainAge ? domainAgeReason(report.domainAge) : undefined,
    },
  ];
}

// RoundMetrics（+ coverage）→ グラフの1点。null は 0 に倒す。
export function metricsToPoint(
  round: number,
  metrics: RoundMetrics,
  coverage: number,
): RoundMetricsPoint {
  return {
    round,
    recall: toNumber(metrics.recall),
    fpr: toNumber(metrics.fpr),
    coverage,
  };
}

// RoundMetrics → メーター props。recall / FPR を number に落として渡す。
export function metricsToMeter(metrics: RoundMetrics): DetectionMeterProps {
  return {
    recall: toNumber(metrics.recall),
    fpr: toNumber(metrics.fpr),
  };
}

// ── スクリプト化シナリオ（承転結） ───────────────────────────────────
// 承: Gen1 がすり抜ける（recall 低・未検知）。
// 転: 型が変異して channel/レバーを変えつつ、防御が呼ぶツールを増やして学習（coverage 増）。
// 結: 最終ラウンドで recall が高く回復し、現ラウンドの型を検知（detected=true）。
// recall は母集団に対する指標なのでギザギザ、detected は「この型を捕まえたか」の単一フラグ。
// 両者は別物として共存する。

// レポート共通の必須フィールド（finding 以外）。
const REPORT_BASE = {
  truncated: false,
  truncatedReason: null,
  bonus: { items: [], total: 0, capped: false },
} satisfies Pick<
  InvestigationReport,
  "truncated" | "truncatedReason" | "bonus"
>;

export const DEMO_ROUNDS: DemoScenarioRound[] = [
  {
    round: 1,
    pattern: {
      id: "demo-gen1",
      generation: 1,
      sourceContext: "recon:financial",
      channel: "email",
      levers: {
        urgency: { tactic: "deadline", intensity: 1 },
        authority: { impersonates: "financial", credibilityTricks: ["formal_tone"] },
        incentive: { type: "fear", hook: "account_loss", intensity: 1 },
        callToAction: { action: "click_link", friction: "low" },
        personalization: { level: "broadcast", signals: [] },
        isolation: { tactic: "none", intensity: 0 },
      },
      detectionResult: { detected: false, missedBy: ["urlReputation", "senderAuth"] },
    },
    report: {
      ...REPORT_BASE,
      knownScams: { status: "ok", matches: [] },
      officialAlerts: { status: "ok", matches: [] },
    },
    result: { detected: false, score: 40 },
    metrics: { recall: 0.2, fpr: 0.1 },
    coverage: 0.3,
  },
  {
    round: 2,
    pattern: {
      id: "demo-gen2",
      generation: 2,
      parentId: "demo-gen1",
      sourceContext: "recon:financial",
      channel: "email",
      levers: {
        urgency: { tactic: "deadline", intensity: 2 },
        authority: {
          impersonates: "financial",
          credibilityTricks: ["formal_tone", "url_lookalike"],
        },
        incentive: { type: "fear", hook: "account_loss", intensity: 2 },
        callToAction: { action: "click_link", friction: "low" },
        personalization: { level: "segmented", signals: ["real_name"] },
        isolation: { tactic: "none", intensity: 0 },
      },
      detectionResult: { detected: false, missedBy: ["senderAuth"] },
    },
    report: {
      ...REPORT_BASE,
      knownScams: { status: "ok", matches: [{ id: "scam-aoki", similarity: 0.71 }] },
      urlReputation: { status: "ok", threats: ["SOCIAL_ENGINEERING"] },
      officialAlerts: {
        status: "ok",
        matches: [{ title: "金融機関をかたるフィッシングに注意", url: "https://example.internal/alert/1" }],
      },
    },
    result: { detected: false, score: 55 },
    metrics: { recall: 0.7, fpr: 0.08 },
    coverage: 0.42,
  },
  {
    round: 3,
    pattern: {
      id: "demo-gen3",
      generation: 3,
      parentId: "demo-gen2",
      sourceContext: "recon:delivery",
      channel: "sms",
      levers: {
        urgency: { tactic: "account_freeze", intensity: 2 },
        authority: { impersonates: "delivery", credibilityTricks: ["reference_number"] },
        incentive: { type: "fear", hook: "penalty", intensity: 2 },
        callToAction: { action: "call_number", friction: "mid" },
        personalization: { level: "segmented", signals: [] },
        isolation: { tactic: "direct_channel", intensity: 1 },
      },
      detectionResult: { detected: false, missedBy: ["domainAge"] },
    },
    report: {
      ...REPORT_BASE,
      knownScams: { status: "ok", matches: [] },
      urlReputation: { status: "ok", threats: [] },
      senderAuth: { status: "ok", spf: "fail", dkim: "none", dmarc: "fail" },
    },
    result: { detected: false, score: 48 },
    metrics: { recall: 0.35, fpr: 0.09 },
    coverage: 0.55,
  },
  {
    round: 4,
    pattern: {
      id: "demo-gen4",
      generation: 4,
      parentId: "demo-gen3",
      sourceContext: "recon:delivery",
      channel: "sms",
      levers: {
        urgency: { tactic: "deadline", intensity: 3 },
        authority: {
          impersonates: "delivery",
          credibilityTricks: ["reference_number", "url_lookalike"],
        },
        incentive: { type: "fear", hook: "penalty", intensity: 3 },
        callToAction: { action: "install_app", friction: "low" },
        personalization: { level: "targeted", signals: ["real_name"] },
        isolation: { tactic: "direct_channel", intensity: 2 },
      },
      detectionResult: { detected: false, missedBy: [] },
    },
    report: {
      ...REPORT_BASE,
      knownScams: { status: "ok", matches: [{ id: "scam-haitatsu", similarity: 0.83 }] },
      urlReputation: { status: "ok", threats: ["MALWARE"] },
      senderAuth: { status: "ok", spf: "fail", dkim: "fail", dmarc: "fail" },
      domainAge: { status: "ok", domain: "track-redelivery.example", ageDays: 3 },
    },
    result: { detected: false, score: 62 },
    metrics: { recall: 0.8, fpr: 0.06 },
    coverage: 0.66,
  },
  {
    round: 5,
    pattern: {
      id: "demo-gen5",
      generation: 5,
      parentId: "demo-gen4",
      sourceContext: "recon:platform",
      channel: "line",
      levers: {
        urgency: { tactic: "limited_offer", intensity: 2 },
        authority: { impersonates: "platform", credibilityTricks: ["logo_mimicry"] },
        incentive: { type: "reward", hook: "prize", intensity: 2 },
        callToAction: { action: "scan_qr", friction: "mid" },
        personalization: { level: "targeted", signals: ["real_name", "thread_injection"] },
        isolation: { tactic: "secrecy", intensity: 2 },
      },
      detectionResult: { detected: false, missedBy: ["officialAlerts"] },
    },
    report: {
      ...REPORT_BASE,
      knownScams: { status: "ok", matches: [] },
      urlReputation: { status: "ok", threats: [] },
      senderAuth: { status: "ok", spf: "pass", dkim: "pass", dmarc: "pass" },
      domainAge: { status: "ok", domain: "promo-campaign.example", ageDays: 12 },
      officialAlerts: { status: "ok", matches: [] },
    },
    result: { detected: false, score: 58 },
    metrics: { recall: 0.55, fpr: 0.07 },
    coverage: 0.74,
  },
  {
    round: 6,
    pattern: {
      id: "demo-gen6",
      generation: 6,
      parentId: "demo-gen5",
      sourceContext: "recon:platform",
      channel: "line",
      levers: {
        urgency: { tactic: "account_freeze", intensity: 3 },
        authority: {
          impersonates: "platform",
          credibilityTricks: ["logo_mimicry", "url_lookalike"],
        },
        incentive: { type: "fear", hook: "account_loss", intensity: 3 },
        callToAction: { action: "input_credentials", friction: "low" },
        personalization: {
          level: "targeted",
          signals: ["real_name", "thread_injection", "internal_jargon"],
        },
        isolation: { tactic: "secrecy", intensity: 3 },
      },
      detectionResult: { detected: true, missedBy: [] },
    },
    report: {
      ...REPORT_BASE,
      knownScams: { status: "ok", matches: [{ id: "scam-platform", similarity: 0.91 }] },
      urlReputation: { status: "ok", threats: ["SOCIAL_ENGINEERING"] },
      senderAuth: { status: "ok", spf: "fail", dkim: "fail", dmarc: "fail" },
      domainAge: { status: "ok", domain: "account-verify.example", ageDays: 1 },
      officialAlerts: {
        status: "ok",
        matches: [{ title: "プラットフォーム認証を装う詐欺", url: "https://example.internal/alert/2" }],
      },
    },
    result: { detected: true, score: 82 },
    metrics: { recall: 0.9, fpr: 0.05 },
    coverage: 0.85,
  },
];

export const TOTAL_ROUNDS = DEMO_ROUNDS.length;

// 指定ラウンド（1始まり）のペイロードを組み立てる純関数。範囲外は [1, TOTAL] にクランプ。
// Server Action（actions.ts）はこれを呼ぶだけ。
export function buildDemoRound(round: number): DemoRoundPayload {
  const clamped = Math.max(1, Math.min(TOTAL_ROUNDS, Math.trunc(round)));
  const scenario = DEMO_ROUNDS[clamped - 1];
  return {
    round: scenario.round,
    totalRounds: TOTAL_ROUNDS,
    pattern: scenario.pattern,
    generation: scenario.pattern.generation,
    meter: metricsToMeter(scenario.metrics),
    logs: reportToToolLogs(scenario.report, scenario.round),
    point: metricsToPoint(scenario.round, scenario.metrics, scenario.coverage),
    detected: scenario.result.detected,
    done: scenario.round >= TOTAL_ROUNDS,
  };
}

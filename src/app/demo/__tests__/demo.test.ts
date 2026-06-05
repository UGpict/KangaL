import { describe, expect, it } from "vitest";
import type { InvestigationReport } from "@/types/investigation";
import {
  DEMO_ROUNDS,
  TOTAL_ROUNDS,
  buildDemoRound,
  metricsToMeter,
  metricsToPoint,
  reportToToolLogs,
} from "../_loop";

// finding 以外の必須フィールドだけを持つ最小レポート（テスト用）。
const baseReport: InvestigationReport = {
  truncated: false,
  truncatedReason: null,
  bonus: { items: [], total: 0, capped: false },
};

describe("reportToToolLogs", () => {
  it("5ツールを knownScams 先頭の固定順で必ず出す", () => {
    const logs = reportToToolLogs(baseReport, 1);
    expect(logs.map((l) => l.toolName)).toEqual([
      "knownScams",
      "urlReputation",
      "senderAuth",
      "officialAlerts",
      "domainAge",
    ]);
  });

  it("レポートに finding があるツールは called=true・reason 付き、無いツールは非選択", () => {
    const report: InvestigationReport = {
      ...baseReport,
      knownScams: { status: "ok", matches: [{ id: "x", similarity: 0.9 }] },
      urlReputation: { status: "ok", threats: ["MALWARE"] },
    };
    const logs = reportToToolLogs(report, 2);
    const byName = Object.fromEntries(logs.map((l) => [l.toolName, l]));

    expect(byName.knownScams.called).toBe(true);
    expect(byName.knownScams.reason).toContain("既知手口");
    expect(byName.urlReputation.called).toBe(true);
    expect(byName.urlReputation.reason).toContain("MALWARE");

    // 呼ばれなかったツールは called=false、reason 無し。
    expect(byName.senderAuth.called).toBe(false);
    expect(byName.senderAuth.reason).toBeUndefined();
    expect(byName.domainAge.called).toBe(false);
    expect(byName.officialAlerts.called).toBe(false);
  });

  it("round をそのまま全エントリへ伝播する", () => {
    const logs = reportToToolLogs(baseReport, 7);
    expect(logs.every((l) => l.round === 7)).toBe(true);
  });

  it("error status は errorMessage を reason に使う", () => {
    const report: InvestigationReport = {
      ...baseReport,
      domainAge: { status: "error", errorMessage: "RDAP タイムアウト" },
    };
    const logs = reportToToolLogs(report, 1);
    const domainAge = logs.find((l) => l.toolName === "domainAge");
    expect(domainAge?.called).toBe(true);
    expect(domainAge?.reason).toBe("RDAP タイムアウト");
  });
});

describe("metricsToPoint / metricsToMeter", () => {
  it("null（分母なし）は 0 に倒す", () => {
    const point = metricsToPoint(3, { recall: null, fpr: null }, 0.5);
    expect(point).toEqual({ round: 3, recall: 0, fpr: 0, coverage: 0.5 });

    const meter = metricsToMeter({ recall: null, fpr: null });
    expect(meter).toEqual({ recall: 0, fpr: 0 });
  });

  it("数値はそのまま通し、coverage を point に同梱する", () => {
    const point = metricsToPoint(4, { recall: 0.8, fpr: 0.06 }, 0.66);
    expect(point).toEqual({ round: 4, recall: 0.8, fpr: 0.06, coverage: 0.66 });
    expect(metricsToMeter({ recall: 0.8, fpr: 0.06 })).toEqual({
      recall: 0.8,
      fpr: 0.06,
    });
  });
});

describe("buildDemoRound", () => {
  it("指定ラウンドのペイロードを実型から組み立てる", () => {
    const payload = buildDemoRound(2);
    expect(payload.round).toBe(2);
    expect(payload.totalRounds).toBe(TOTAL_ROUNDS);
    expect(payload.generation).toBe(payload.pattern.generation);
    expect(payload.logs).toHaveLength(5);
    expect(payload.point.round).toBe(2);
    expect(payload.done).toBe(false);
  });

  it("最終ラウンドは done=true・detected=true", () => {
    const payload = buildDemoRound(TOTAL_ROUNDS);
    expect(payload.done).toBe(true);
    expect(payload.detected).toBe(true);
  });

  it("範囲外のラウンドは [1, TOTAL] にクランプする", () => {
    expect(buildDemoRound(0).round).toBe(1);
    expect(buildDemoRound(-5).round).toBe(1);
    expect(buildDemoRound(999).round).toBe(TOTAL_ROUNDS);
  });
});

describe("シナリオの承転結アーク", () => {
  it("承: 第1ラウンドは Gen1（系統なし）・recall 低・未検知", () => {
    const r1 = DEMO_ROUNDS[0];
    expect(r1.pattern.generation).toBe(1);
    expect(r1.pattern.parentId).toBeUndefined();
    expect(r1.result.detected).toBe(false);
    expect(r1.metrics.recall).toBeLessThan(0.5);
  });

  it("結: 最終ラウンドは recall 高・検知成功", () => {
    const last = DEMO_ROUNDS[TOTAL_ROUNDS - 1];
    expect(last.result.detected).toBe(true);
    expect(Number(last.metrics.recall)).toBeGreaterThanOrEqual(0.85);
  });

  it("転: coverage は単調増加（守備範囲が広がる）", () => {
    for (let i = 1; i < DEMO_ROUNDS.length; i++) {
      expect(DEMO_ROUNDS[i].coverage).toBeGreaterThan(DEMO_ROUNDS[i - 1].coverage);
    }
  });

  it("学習: 呼び出しツール数はラウンドが進むほど概ね増える（最終は5ツール全て）", () => {
    const lastReport = DEMO_ROUNDS[TOTAL_ROUNDS - 1].report;
    const lastCalled = reportToToolLogs(lastReport, TOTAL_ROUNDS).filter(
      (l) => l.called,
    ).length;
    expect(lastCalled).toBe(5);

    const firstCalled = reportToToolLogs(DEMO_ROUNDS[0].report, 1).filter(
      (l) => l.called,
    ).length;
    expect(firstCalled).toBeLessThan(lastCalled);
  });

  it("各ラウンドの round は 1..TOTAL の連番", () => {
    expect(DEMO_ROUNDS.map((r) => r.round)).toEqual(
      Array.from({ length: TOTAL_ROUNDS }, (_, i) => i + 1),
    );
  });
});

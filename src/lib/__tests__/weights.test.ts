import { describe, expect, it } from "vitest";
import { summarizeBonus } from "../weights";
import type { InvestigationBonus } from "@/types/investigation";

describe("summarizeBonus (M5: capped UI helper)", () => {
  it("returns zeros for missing bonus", () => {
    expect(summarizeBonus(undefined)).toEqual({
      rawTotal: 0,
      total: 0,
      capped: false,
    });
    expect(summarizeBonus(null)).toEqual({
      rawTotal: 0,
      total: 0,
      capped: false,
    });
  });

  it("rawTotal equals item sum when not capped", () => {
    const bonus: InvestigationBonus = {
      items: [
        { source: "webRisk", points: 15 },
        { source: "senderAuth", points: 8 },
      ],
      total: 23,
      capped: false,
    };
    expect(summarizeBonus(bonus)).toEqual({
      rawTotal: 23,
      total: 23,
      capped: false,
    });
  });

  it("when capped, rawTotal > total and capped:true so the UI can show both", () => {
    // 15 + 10 + 8 + 5 + 8 = 46, but cap is 25.
    const bonus: InvestigationBonus = {
      items: [
        { source: "webRisk", points: 15 },
        { source: "domainAge", points: 10 },
        { source: "senderAuth", points: 8 },
        { source: "knownScams", points: 5 },
        { source: "officialAlerts", points: 8 },
      ],
      total: 25,
      capped: true,
    };
    const summary = summarizeBonus(bonus);
    expect(summary.rawTotal).toBe(46);
    expect(summary.total).toBe(25);
    expect(summary.capped).toBe(true);
    expect(summary.rawTotal).toBeGreaterThan(summary.total);
  });
});

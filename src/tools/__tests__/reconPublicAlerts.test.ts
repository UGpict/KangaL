import { describe, expect, it } from "vitest";
import {
  reconPublicAlerts,
  type AlertTrend,
} from "../reconPublicAlerts";

function trend(id: string, date: string): AlertTrend {
  return { id, title: `alert-${id}`, category: "financial", date };
}

describe("reconPublicAlerts (injected fetcher)", () => {
  it("returns trends newest-first regardless of source order", async () => {
    // Deliberately out of chronological order.
    const fetcher = async () => [
      trend("a", "2026-05-01"),
      trend("b", "2026-05-30"),
      trend("c", "2026-05-15"),
    ];
    const result = await reconPublicAlerts(fetcher);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trends.map((t) => t.id)).toEqual(["b", "c", "a"]);
    }
  });

  it("caps the result at 5 trends even when more are available", async () => {
    const fetcher = async () =>
      Array.from({ length: 12 }, (_, i) =>
        // Descending dates so order is well-defined; expect the 5 newest.
        trend(`x${i}`, `2026-05-${String(28 - i).padStart(2, "0")}`),
      );
    const result = await reconPublicAlerts(fetcher);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trends).toHaveLength(5);
      expect(result.trends.map((t) => t.id)).toEqual([
        "x0",
        "x1",
        "x2",
        "x3",
        "x4",
      ]);
    }
  });

  it("returns ok:false (no_alerts) when the fetcher yields an empty list", async () => {
    const result = await reconPublicAlerts(async () => []);
    expect(result).toEqual({ ok: false, reason: "no_alerts" });
  });
});

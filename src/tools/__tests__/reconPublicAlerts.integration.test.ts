import { describe, expect, it } from "vitest";
import { reconPublicAlerts } from "../reconPublicAlerts";

const RUN_INTEGRATION = process.env.INTEGRATION === "1";

// Smoke test for the default fetcher (real static snapshot read). Gated so the
// CI default run stays decoupled from the bundled data file's exact contents.
// No network I/O — this only exercises the snapshot import path end to end.
describe.skipIf(!RUN_INTEGRATION)("reconPublicAlerts (real snapshot)", () => {
  it("reads the bundled snapshot and returns up to 5 newest trends", async () => {
    const result = await reconPublicAlerts();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trends.length).toBeGreaterThan(0);
      expect(result.trends.length).toBeLessThanOrEqual(5);
      // Newest-first invariant holds on real data.
      for (let i = 1; i < result.trends.length; i++) {
        expect(
          result.trends[i - 1].date >= result.trends[i].date,
        ).toBe(true);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { checkOfficialAlerts } from "../checkOfficialAlerts";

describe("checkOfficialAlerts (static snapshot)", () => {
  it("returns ok:false (no_keywords) when no usable keywords are passed", async () => {
    const result = await checkOfficialAlerts({ keywords: [] });
    expect(result).toEqual({ ok: false, reason: "no_keywords" });
  });

  it("filters out empty / whitespace keywords and treats the rest as no_keywords if all are blank", async () => {
    const result = await checkOfficialAlerts({ keywords: ["", "   "] });
    expect(result).toEqual({ ok: false, reason: "no_keywords" });
  });

  it("returns matches whose title contains a fictional financial-institution keyword", async () => {
    const result = await checkOfficialAlerts({ keywords: ["カンガル銀行"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches.length).toBeGreaterThan(0);
      for (const m of result.matches) {
        expect(m.title).toContain("カンガル銀行");
        expect(m.link.startsWith("snapshot://officialAlerts/")).toBe(true);
      }
    }
  });

  it("returns matches that align with the BEC routing path (取引先 keyword)", async () => {
    // This is the path exercised by msg-003 (authority.impersonates =
    // business_partner). Verifies the static dataset actually supports the
    // BEC scenario the demo depends on.
    const result = await checkOfficialAlerts({ keywords: ["取引先"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches.length).toBeGreaterThan(0);
    }
  });

  it("returns empty matches when no keyword hits any alert", async () => {
    const result = await checkOfficialAlerts({
      keywords: ["zzz-this-substring-should-not-occur-anywhere"],
    });
    expect(result).toEqual({ ok: true, matches: [] });
  });

  it("caps results at 5 matches even for a very common substring", async () => {
    // `を装う` appears in nearly every alert title — would be 20+ matches
    // without the cap.
    const result = await checkOfficialAlerts({ keywords: ["を装う"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches.length).toBeLessThanOrEqual(5);
      expect(result.matches.length).toBe(5);
    }
  });

  it("multiple keywords: returns matches if ANY keyword hits a title (OR semantics)", async () => {
    const result = await checkOfficialAlerts({
      keywords: ["カンガル銀行", "definitely-not-in-any-title"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches.length).toBeGreaterThan(0);
      for (const m of result.matches) {
        expect(m.title).toContain("カンガル銀行");
      }
    }
  });
});

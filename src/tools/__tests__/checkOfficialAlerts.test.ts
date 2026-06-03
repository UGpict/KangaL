import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearCacheForTests,
  checkOfficialAlerts,
} from "../checkOfficialAlerts";

const mockFetch = vi.fn();

// All institution names below are fictional per CLAUDE.md.
const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <item rdf:about="https://example.com/1">
    <title><![CDATA[カンガル銀行を装う詐欺メールに注意]]></title>
    <link>https://example.com/1</link>
  </item>
  <item rdf:about="https://example.com/2">
    <title>クマ運輸の配送通知を装う詐欺</title>
    <link>https://example.com/2</link>
  </item>
  <item rdf:about="https://example.com/3">
    <title>無関係なお知らせ</title>
    <link>https://example.com/3</link>
  </item>
</rdf:RDF>`;

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  __clearCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function rssResponse(xml: string) {
  return {
    ok: true,
    text: async () => xml,
  };
}

describe("checkOfficialAlerts", () => {
  it("returns ok:false (no_keywords) when no usable keywords are passed", async () => {
    const result = await checkOfficialAlerts({ keywords: ["", "   "] });
    expect(result).toEqual({ ok: false, reason: "no_keywords" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns matching items by keyword inclusion in title", async () => {
    mockFetch.mockResolvedValueOnce(rssResponse(SAMPLE_RSS));
    const result = await checkOfficialAlerts({ keywords: ["カンガル銀行"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches).toEqual([
        {
          title: "カンガル銀行を装う詐欺メールに注意",
          link: "https://example.com/1",
        },
      ]);
    }
  });

  it("returns empty matches when no keyword hits any item", async () => {
    mockFetch.mockResolvedValueOnce(rssResponse(SAMPLE_RSS));
    const result = await checkOfficialAlerts({ keywords: ["まったく無関係"] });
    expect(result).toEqual({ ok: true, matches: [] });
  });

  it("serves cached items on second call (no second fetch)", async () => {
    mockFetch.mockResolvedValueOnce(rssResponse(SAMPLE_RSS));
    const first = await checkOfficialAlerts({ keywords: ["カンガル銀行"] });
    const second = await checkOfficialAlerts({ keywords: ["クマ運輸"] });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.matches.map((m) => m.title)).toEqual([
        "クマ運輸の配送通知を装う詐欺",
      ]);
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await checkOfficialAlerts({ keywords: ["カンガル銀行"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("http_500");
  });

  it("returns ok:false when fetch rejects", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));
    const result = await checkOfficialAlerts({ keywords: ["カンガル銀行"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timeout");
  });
});

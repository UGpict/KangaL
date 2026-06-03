import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkUrlReputation } from "../checkUrlReputation";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  delete process.env.WEB_RISK_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkUrlReputation", () => {
  it("returns ok:false (missing_api_key) when WEB_RISK_API_KEY is not set", async () => {
    const result = await checkUrlReputation({ url: "https://example.com" });
    expect(result).toEqual({ ok: false, reason: "missing_api_key" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns ok:false (invalid_url) when the URL is not http(s)", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    const result = await checkUrlReputation({ url: "not-a-url" });
    expect(result).toEqual({ ok: false, reason: "invalid_url" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns ok:true with empty threats for a safe URL", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    const result = await checkUrlReputation({ url: "https://example.com" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://example.com");
      expect(result.threats).toEqual([]);
    }
    // SSRF guard sanity check: we only hit webrisk.googleapis.com,
    // never the user-supplied URL.
    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl.startsWith("https://webrisk.googleapis.com/")).toBe(true);
    expect(calledUrl).toContain("uri=https%3A%2F%2Fexample.com");
    expect(calledUrl).toContain("key=test-key");
  });

  it("returns ok:true with threats when Web Risk reports them", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        threat: { threatTypes: ["SOCIAL_ENGINEERING", "MALWARE"] },
      }),
    });
    const result = await checkUrlReputation({ url: "https://bad.example.com" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.threats).toEqual(["SOCIAL_ENGINEERING", "MALWARE"]);
    }
  });

  it("returns ok:false (http_503) on HTTP error", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const result = await checkUrlReputation({ url: "https://example.com" });
    expect(result).toEqual({ ok: false, reason: "http_503" });
  });

  it("returns ok:false when fetch rejects (network error)", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const result = await checkUrlReputation({ url: "https://example.com" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("network down");
  });
});

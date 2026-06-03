import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearCacheForTests,
  checkDomainAge,
} from "../checkDomainAge";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  __clearCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function rdapResponse(registrationDate: string) {
  return {
    ok: true,
    json: async () => ({
      events: [
        { eventAction: "last changed", eventDate: "2026-05-01T00:00:00Z" },
        { eventAction: "registration", eventDate: registrationDate },
      ],
    }),
  };
}

describe("checkDomainAge", () => {
  it("returns ok:false (invalid_domain) for non-domain input", async () => {
    const result = await checkDomainAge({ domain: "https://example.com/path" });
    expect(result).toEqual({ ok: false, reason: "invalid_domain" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("parses registration date and computes ageDays", async () => {
    // Fixed-ish: 30 days before "now". Use jest's fake timers for stability.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T12:00:00Z"));
    const registeredAt = "2026-05-04T12:00:00Z"; // exactly 30 days ago
    mockFetch.mockResolvedValueOnce(rdapResponse(registeredAt));

    const result = await checkDomainAge({ domain: "kangaru-shoji.example" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.domain).toBe("kangaru-shoji.example");
      expect(result.registeredAt).toBe(registeredAt);
      expect(result.ageDays).toBe(30);
    }
    vi.useRealTimers();
  });

  it("serves cached value on second call (no second fetch)", async () => {
    mockFetch.mockResolvedValueOnce(
      rdapResponse("2026-05-01T00:00:00Z"),
    );
    const first = await checkDomainAge({ domain: "example.com" });
    const second = await checkDomainAge({ domain: "example.com" });
    expect(first).toEqual(second);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await checkDomainAge({ domain: "example.com" });
    expect(result).toEqual({ ok: false, reason: "http_404" });
  });

  it("returns ok:false when RDAP response has no registration event", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [{ eventAction: "last changed", eventDate: "2026-01-01" }] }),
    });
    const result = await checkDomainAge({ domain: "example.com" });
    expect(result).toEqual({ ok: false, reason: "no_registration_event" });
  });

  it("returns ok:false when fetch rejects", async () => {
    mockFetch.mockRejectedValueOnce(new Error("dns failure"));
    const result = await checkDomainAge({ domain: "example.com" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("dns failure");
  });
});

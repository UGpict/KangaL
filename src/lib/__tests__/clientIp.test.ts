import { describe, expect, it } from "vitest";
import { getClientIp } from "../clientIp";

function requestWith(header: string | null): Request {
  return new Request("http://localhost/api/judge", {
    method: "POST",
    headers: header === null ? {} : { "x-forwarded-for": header },
  });
}

describe("getClientIp", () => {
  it('returns "local" when X-Forwarded-For is absent (next dev)', () => {
    expect(getClientIp(requestWith(null))).toBe("local");
  });

  it("returns the single IP when only one is present", () => {
    expect(getClientIp(requestWith("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("takes the LAST entry — earlier ones are client-forgeable", () => {
    expect(getClientIp(requestWith("6.6.6.6, 203.0.113.7"))).toBe(
      "203.0.113.7",
    );
  });

  it("trims whitespace and skips empty trailing tokens", () => {
    expect(getClientIp(requestWith("  6.6.6.6 ,  203.0.113.7  , "))).toBe(
      "203.0.113.7",
    );
  });

  it('returns "local" for a header of only separators', () => {
    expect(getClientIp(requestWith(" , ,"))).toBe("local");
  });

  it("passes IPv6 addresses through unchanged", () => {
    expect(getClientIp(requestWith("2001:db8::1"))).toBe("2001:db8::1");
  });
});

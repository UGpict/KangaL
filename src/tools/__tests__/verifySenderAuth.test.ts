import { describe, expect, it } from "vitest";
import { verifySenderAuth } from "../verifySenderAuth";

describe("verifySenderAuth", () => {
  it("parses an all-pass header", async () => {
    const result = await verifySenderAuth({
      authenticationResults: "spf=pass dkim=pass dmarc=pass",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spf).toBe("pass");
      expect(result.dkim).toBe("pass");
      expect(result.dmarc).toBe("pass");
    }
  });

  it("parses an all-fail header", async () => {
    const result = await verifySenderAuth({
      authenticationResults: "spf=fail dkim=fail dmarc=fail",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spf).toBe("fail");
      expect(result.dkim).toBe("fail");
      expect(result.dmarc).toBe("fail");
    }
  });

  it("treats softfail/permerror/temperror as fail", async () => {
    const result = await verifySenderAuth({
      authenticationResults: "spf=softfail dkim=permerror dmarc=fail",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spf).toBe("fail");
      expect(result.dkim).toBe("fail");
      expect(result.dmarc).toBe("fail");
    }
  });

  it("treats neutral/missing as none", async () => {
    const result = await verifySenderAuth({
      authenticationResults: "spf=neutral",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spf).toBe("none");
      expect(result.dkim).toBe("none"); // missing → none
      expect(result.dmarc).toBe("none");
    }
  });

  it("returns ok:false on empty input", async () => {
    const result = await verifySenderAuth({ authenticationResults: "" });
    expect(result).toEqual({ ok: false, reason: "empty_input" });
  });

  it("returns ok:false when input has no recognizable auth tokens", async () => {
    const result = await verifySenderAuth({
      authenticationResults: "Received-SPF: pass (no spf= token)",
    });
    // The "Received-SPF:" line lacks the literal `spf=value` form.
    expect(result).toEqual({ ok: false, reason: "no_auth_tokens" });
  });

  it("is case-insensitive on token keys and values", async () => {
    const result = await verifySenderAuth({
      authenticationResults: "SPF=Pass DKIM=PASS DMARC=Pass",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spf).toBe("pass");
      expect(result.dkim).toBe("pass");
      expect(result.dmarc).toBe("pass");
    }
  });
});

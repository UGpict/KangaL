import { describe, expect, it } from "vitest";
import type { ParsedMessage } from "@/lib/gmailParse";
import {
  callbackErrorMessage,
  classifyGmailError,
  detailToActive,
  gmailActiveId,
  gmailErrorMessage,
  isGmailActiveId,
  truncationNotice,
} from "@/lib/gmailClient";

const baseDetail: ParsedMessage = {
  from: "差出人 <decoded@example.com>",
  subject: "デコード済み件名",
  body: "本文テキスト",
  authenticationResults: "spf=pass dkim=pass dmarc=pass",
  truncated: false,
  authTruncated: false,
};

describe("gmail active id namespacing", () => {
  it("prefixes gmail ids and detects them", () => {
    const id = gmailActiveId("abc123");
    expect(id).toBe("gmail:abc123");
    expect(isGmailActiveId(id)).toBe(true);
  });

  it("does not treat sample ids as gmail", () => {
    expect(isGmailActiveId("msg-001")).toBe(false);
  });
});

describe("detailToActive", () => {
  const summary = { from: "meta from", subject: "meta subject", date: "2026-06-10" };

  it("maps detail into the shared ActiveMessage shape, preferring decoded headers", () => {
    const active = detailToActive("abc", summary, baseDetail);
    expect(active).toEqual({
      id: "gmail:abc",
      source: "gmail",
      from: "差出人 <decoded@example.com>",
      subject: "デコード済み件名",
      receivedAt: "2026-06-10",
      body: "本文テキスト",
      authenticationResults: "spf=pass dkim=pass dmarc=pass",
      truncated: false,
      authTruncated: false,
    });
  });

  it("falls back to summary metadata when detail headers are empty", () => {
    const active = detailToActive("abc", summary, {
      ...baseDetail,
      from: "",
      subject: "",
    });
    expect(active.from).toBe("meta from");
    expect(active.subject).toBe("meta subject");
  });

  it("normalizes blank auth to undefined so the judge route sees no header", () => {
    const active = detailToActive("abc", summary, {
      ...baseDetail,
      authenticationResults: "   ",
    });
    expect(active.authenticationResults).toBeUndefined();
  });
});

describe("truncationNotice", () => {
  it("returns null when nothing was clamped", () => {
    expect(truncationNotice(false, false)).toBeNull();
    expect(truncationNotice(undefined, undefined)).toBeNull();
  });

  it("returns a note when body or auth was clamped", () => {
    expect(truncationNotice(true, false)).toBe("長文のため一部を省略して判定します");
    expect(truncationNotice(false, true)).toBe("長文のため一部を省略して判定します");
  });
});

describe("classifyGmailError", () => {
  it("maps 401 to reconnect (expired token is a normal state)", () => {
    expect(classifyGmailError(401)).toBe("reconnect");
  });

  it("maps 429 to rate_limited", () => {
    expect(classifyGmailError(429)).toBe("rate_limited");
  });

  it("maps 5xx to upstream", () => {
    expect(classifyGmailError(500)).toBe("upstream");
    expect(classifyGmailError(503)).toBe("upstream");
  });

  it("maps a thrown/absent response to network", () => {
    expect(classifyGmailError(null)).toBe("network");
  });
});

describe("gmailErrorMessage", () => {
  it("is human-readable Japanese, never a machine code", () => {
    for (const kind of ["reconnect", "rate_limited", "upstream", "network"] as const) {
      const msg = gmailErrorMessage(kind);
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toMatch(/gmail_upstream|connected|\b[45]\d\d\b/);
    }
    expect(gmailErrorMessage("reconnect")).toContain("再連携");
  });
});

describe("callbackErrorMessage", () => {
  it("returns null when there is no error code", () => {
    expect(callbackErrorMessage(null)).toBeNull();
  });

  it("maps state_mismatch to human text, not the raw code", () => {
    const msg = callbackErrorMessage("state_mismatch");
    expect(msg).toBe("連携に失敗しました。もう一度お試しください。");
    expect(msg).not.toContain("state_mismatch");
  });

  it("distinguishes user cancellation", () => {
    expect(callbackErrorMessage("access_denied")).toContain("キャンセル");
  });

  it("maps unknown codes to the generic failure message", () => {
    expect(callbackErrorMessage("something_new")).toBe(
      "連携に失敗しました。もう一度お試しください。",
    );
  });
});

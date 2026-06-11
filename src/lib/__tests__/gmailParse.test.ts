import { describe, expect, it } from "vitest";
import {
  htmlToText,
  parseMessage,
  summarizeMessage,
  type GmailMessageFull,
  type GmailMessagePart,
} from "@/lib/gmailParse";
import { MAX_AUTH_LENGTH, MAX_MESSAGE_LENGTH } from "@/lib/inputLimits";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function leaf(
  mimeType: string,
  text: string,
  extra: Partial<GmailMessagePart> = {},
): GmailMessagePart {
  return { mimeType, body: { data: b64(text) }, ...extra };
}

function msg(payload: GmailMessagePart, headers = payload.headers): GmailMessageFull {
  return { id: "m1", snippet: "snip", payload: { ...payload, headers } };
}

const HEADERS = [
  { name: "From", value: "Alice <alice@example.com>" },
  { name: "Subject", value: "Hello there" },
  { name: "Date", value: "Tue, 10 Jun 2026 09:00:00 +0900" },
];

describe("parseMessage — body extraction", () => {
  it("reads a single text/plain part", () => {
    const m = msg({ ...leaf("text/plain", "plain body here"), headers: HEADERS });
    const p = parseMessage(m);
    expect(p.body).toBe("plain body here");
    expect(p.from).toBe("Alice <alice@example.com>");
    expect(p.subject).toBe("Hello there");
    expect(p.truncated).toBe(false);
  });

  it("converts a text/html-only message to stripped text", () => {
    const html =
      "<html><head><style>.x{color:red}</style></head><body>" +
      "<script>alert('x')</script><p>Hi&nbsp;there &amp; welcome</p>" +
      "<a href='http://e.com'>link</a></body></html>";
    const m = msg({ ...leaf("text/html", html), headers: HEADERS });
    const p = parseMessage(m);
    expect(p.body).toContain("Hi there & welcome");
    expect(p.body).toContain("link");
    expect(p.body).not.toContain("alert");
    expect(p.body).not.toContain("color:red");
    expect(p.body).not.toContain("<");
  });

  it("prefers text/plain over text/html in multipart/alternative", () => {
    const m = msg({
      mimeType: "multipart/alternative",
      headers: HEADERS,
      parts: [
        leaf("text/plain", "PLAIN wins"),
        leaf("text/html", "<p>HTML loses</p>"),
      ],
    });
    expect(parseMessage(m).body).toBe("PLAIN wins");
  });

  it("walks nested multipart and ignores attachments", () => {
    const m = msg({
      mimeType: "multipart/mixed",
      headers: HEADERS,
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            leaf("text/plain", "deep plain body"),
            leaf("text/html", "<p>deep html</p>"),
          ],
        },
        // attachment: must be skipped even though it claims text/plain
        {
          mimeType: "text/plain",
          filename: "evil.txt",
          body: { attachmentId: "att-1" },
        },
      ],
    });
    expect(parseMessage(m).body).toBe("deep plain body");
  });

  it("decodes base64url url-safe characters (- and _) correctly", () => {
    const unicode = "Zürich café — naïve 😀 vis-à-vis ¿qué? ©2026";
    const data = Buffer.from(unicode, "utf8").toString("base64url");
    expect(/[-_]/.test(data)).toBe(true); // genuinely exercises url-safe alphabet
    const m = msg({
      mimeType: "text/plain",
      headers: HEADERS,
      body: { data },
    });
    expect(parseMessage(m).body).toBe(unicode);
  });

  it("returns empty body when no text part exists", () => {
    const m = msg({
      mimeType: "multipart/mixed",
      headers: HEADERS,
      parts: [
        { mimeType: "image/png", filename: "p.png", body: { attachmentId: "a" } },
      ],
    });
    expect(parseMessage(m).body).toBe("");
  });
});

describe("parseMessage — Authentication-Results", () => {
  it("joins multiple Authentication-Results headers", () => {
    const headers = [
      ...HEADERS,
      { name: "Authentication-Results", value: "spf=pass smtp.mailfrom=a.com" },
      { name: "Authentication-Results", value: "dkim=pass header.d=a.com" },
    ];
    const p = parseMessage(msg({ ...leaf("text/plain", "x"), headers }));
    expect(p.authenticationResults).toBe(
      "spf=pass smtp.mailfrom=a.com\ndkim=pass header.d=a.com",
    );
  });

  it("returns empty string when the header is absent", () => {
    const p = parseMessage(msg({ ...leaf("text/plain", "x"), headers: HEADERS }));
    expect(p.authenticationResults).toBe("");
  });
});

describe("parseMessage — truncation", () => {
  it("clamps an over-length body and flags truncated", () => {
    const big = "a".repeat(MAX_MESSAGE_LENGTH + 500);
    const p = parseMessage(msg({ ...leaf("text/plain", big), headers: HEADERS }));
    expect(p.body.length).toBe(MAX_MESSAGE_LENGTH);
    expect(p.truncated).toBe(true);
    expect(p.authTruncated).toBe(false);
  });

  it("clamps over-length Authentication-Results with a distinct flag", () => {
    const headers = [
      ...HEADERS,
      { name: "Authentication-Results", value: "b".repeat(MAX_AUTH_LENGTH + 50) },
    ];
    const p = parseMessage(msg({ ...leaf("text/plain", "x"), headers }));
    expect(p.authenticationResults.length).toBe(MAX_AUTH_LENGTH);
    expect(p.authTruncated).toBe(true);
    expect(p.truncated).toBe(false);
  });
});

describe("htmlToText", () => {
  it("keeps &amp; literal (does not double-decode)", () => {
    expect(htmlToText("a &amp;lt; b")).toBe("a &lt; b");
  });
  it("collapses whitespace", () => {
    expect(htmlToText("<p>a</p>\n\n   <p>b</p>")).toBe("a b");
  });
});

describe("summarizeMessage", () => {
  it("extracts the list-row fields", () => {
    const s = summarizeMessage(msg({ ...leaf("text/plain", "x"), headers: HEADERS }));
    expect(s).toEqual({
      id: "m1",
      from: "Alice <alice@example.com>",
      subject: "Hello there",
      date: "Tue, 10 Jun 2026 09:00:00 +0900",
      snippet: "snip",
    });
  });
});

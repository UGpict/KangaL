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
const bytesB64 = (bytes: number[]) =>
  Buffer.from(bytes).toString("base64url");

function leaf(
  mimeType: string,
  text: string,
  extra: Partial<GmailMessagePart> = {},
): GmailMessagePart {
  return { mimeType, body: { data: b64(text) }, ...extra };
}

// A leaf whose body bytes are pre-encoded in a non-UTF-8 charset, declared via
// a part-level Content-Type header (mirrors what Gmail format=full returns).
function rawLeaf(
  mimeType: string,
  bytes: number[],
  charset: string,
): GmailMessagePart {
  return {
    mimeType,
    headers: [
      { name: "Content-Type", value: `${mimeType}; charset="${charset}"` },
    ],
    body: { data: bytesB64(bytes) },
  };
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

describe("parseMessage — URL compression", () => {
  it("folds an over-length tracking URL to scheme://host/... keeping body untruncated", () => {
    // A real-world tracking URL: short visible text, enormous query string that
    // would otherwise eat the whole truncation budget.
    const longUrl =
      "https://links.n.myprotein.com/ls/click?upn=" + "u001.lhZx".repeat(60);
    expect(longUrl.length).toBeGreaterThan(100); // well over the fold threshold
    const text = `Hi! See ${longUrl} thanks`;
    const p = parseMessage(msg({ ...leaf("text/plain", text), headers: HEADERS }));
    expect(p.body).toContain("https://links.n.myprotein.com/...");
    expect(p.body).not.toContain("upn=");
    expect(p.body).toContain("Hi! See");
    expect(p.body).toContain("thanks");
    expect(p.truncated).toBe(false);
  });

  it("returns budget so a long-URL message that was over MAX is no longer truncated", () => {
    // Body is dominated by one giant URL; folding it drops length under MAX.
    const giant = "https://t.example.com/x?q=" + "a".repeat(MAX_MESSAGE_LENGTH);
    const p = parseMessage(msg({ ...leaf("text/plain", giant), headers: HEADERS }));
    expect(p.truncated).toBe(false);
    expect(p.body).toBe("https://t.example.com/...");
  });

  it("leaves a short URL (<= threshold) unfolded", () => {
    const shortUrl = "https://ex.com/p?a=1";
    const p = parseMessage(
      msg({ ...leaf("text/plain", `see ${shortUrl} ok`), headers: HEADERS }),
    );
    expect(p.body).toContain(shortUrl);
    expect(p.body).not.toContain("/...");
  });

  it("uses ASCII dots, never a non-ASCII ellipsis", () => {
    const longUrl = "https://host.example.com/a?" + "k=v&".repeat(40);
    const p = parseMessage(
      msg({ ...leaf("text/plain", `x ${longUrl} y`), headers: HEADERS }),
    );
    expect(p.body).not.toContain("…");
    expect(p.body).toContain("https://host.example.com/...");
  });
});

describe("parseMessage — charset decoding", () => {
  // "あ" (U+3042) in each legacy Japanese encoding.
  const SJIS_A = [0x82, 0xa0];
  const EUCJP_A = [0xa4, 0xa2];
  const ISO2022JP_A = [0x1b, 0x24, 0x42, 0x24, 0x22, 0x1b, 0x28, 0x42];

  it("decodes Shift_JIS via the part Content-Type charset", () => {
    const part = rawLeaf("text/plain", SJIS_A, "Shift_JIS");
    const headers = [...HEADERS, ...(part.headers ?? [])];
    const p = parseMessage(msg({ ...part, headers }));
    expect(p.body).toBe("あ");
  });

  it("decodes EUC-JP", () => {
    const part = rawLeaf("text/plain", EUCJP_A, "EUC-JP");
    const headers = [...HEADERS, ...(part.headers ?? [])];
    expect(parseMessage(msg({ ...part, headers })).body).toBe("あ");
  });

  it("decodes ISO-2022-JP", () => {
    const part = rawLeaf("text/plain", ISO2022JP_A, "ISO-2022-JP");
    const headers = [...HEADERS, ...(part.headers ?? [])];
    expect(parseMessage(msg({ ...part, headers })).body).toBe("あ");
  });

  it("falls back to UTF-8 when no charset is declared", () => {
    const jp = "日本語のテスト";
    const p = parseMessage(
      msg({ ...leaf("text/plain", jp), headers: HEADERS }),
    );
    expect(p.body).toBe(jp);
  });

  it("falls back to UTF-8 on an unknown charset label", () => {
    const jp = "ねこ";
    const part: GmailMessagePart = {
      mimeType: "text/plain",
      headers: [{ name: "Content-Type", value: 'text/plain; charset="x-bogus"' }],
      body: { data: b64(jp) },
    };
    const headers = [...HEADERS, ...(part.headers ?? [])];
    expect(parseMessage(msg({ ...part, headers })).body).toBe(jp);
  });
});

describe("parseMessage — RFC2047 encoded-word headers", () => {
  it("decodes a Base64 (B) encoded-word subject and from", () => {
    const enc = (s: string) =>
      "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=";
    const headers = [
      { name: "From", value: `${enc("送信者")} <a@ex.com>` },
      { name: "Subject", value: enc("テスト件名") },
    ];
    const p = parseMessage(msg({ ...leaf("text/plain", "x"), headers }));
    expect(p.subject).toBe("テスト件名");
    expect(p.from).toContain("送信者");
    expect(p.from).toContain("<a@ex.com>");
  });

  it("decodes a Quoted-Printable (Q) encoded-word", () => {
    // "a b" with _ for space and =41 for 'A' style is overkill; use a real é.
    const headers = [
      { name: "Subject", value: "=?UTF-8?Q?caf=C3=A9_test?=" },
    ];
    const p = parseMessage(msg({ ...leaf("text/plain", "x"), headers }));
    expect(p.subject).toBe("café test");
  });

  it("leaves an already-plain subject unchanged (idempotent no-op)", () => {
    const headers = [{ name: "Subject", value: "Plain 件名 = ok" }];
    const p = parseMessage(msg({ ...leaf("text/plain", "x"), headers }));
    expect(p.subject).toBe("Plain 件名 = ok");
  });
});

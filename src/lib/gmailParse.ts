// Pure parsing of a Gmail `format=full` message into the /api/judge input
// shape. No network, no token, no I/O — everything here is deterministic and
// fixture-tested. The route layer fetches; this module only reshapes.

import { MAX_AUTH_LENGTH, MAX_MESSAGE_LENGTH } from "@/lib/inputLimits";

export type GmailHeader = { name: string; value: string };

export type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailMessagePart[];
};

export type GmailMessageFull = {
  id?: string;
  snippet?: string;
  payload?: GmailMessagePart;
};

export type ParsedMessage = {
  from: string;
  subject: string;
  body: string;
  authenticationResults: string;
  truncated: boolean; // body was clamped to MAX_MESSAGE_LENGTH
  authTruncated: boolean; // authenticationResults was clamped to MAX_AUTH_LENGTH
};

export type MessageSummary = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return "";
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (h.name.toLowerCase() === lower) return h.value ?? "";
  }
  return "";
}

function headerValues(
  headers: GmailHeader[] | undefined,
  name: string,
): string[] {
  if (!headers) return [];
  const lower = name.toLowerCase();
  return headers
    .filter((h) => h.name.toLowerCase() === lower)
    .map((h) => h.value ?? "");
}

// WHATWG TextDecoder accepts these labels directly (and many aliases). Unknown
// labels throw at construction time, which we catch and fall back to utf-8.
function normalizeCharset(charset: string): string {
  return charset.trim().toLowerCase();
}

function decodeBase64Url(data: string, charset = "utf-8"): string {
  // Gmail uses base64url (-_). Node's "base64url" handles missing padding.
  const bytes = Buffer.from(data, "base64url");
  try {
    return new TextDecoder(normalizeCharset(charset)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// Reads the charset= parameter from a part's own Content-Type header. Real
// Gmail format=full parts carry e.g. `text/plain; charset="ISO-2022-JP"`.
// Absent → utf-8 (the overwhelming default and a safe fallback).
function partCharset(part: GmailMessagePart): string {
  const ct = headerValue(part.headers, "Content-Type");
  const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(ct);
  return m ? m[1] : "utf-8";
}

// Fold over-length URLs to scheme://host/... so tracking links (1KB+ of
// upn=/utm_/click params) don't consume the truncation budget. The judge's
// investigation tools receive URLs/domains the LLM extracts from the text —
// they consume the host (checkDomainAge) or a host-bearing URL
// (checkUrlReputation), never the path/query — so folding loses nothing the
// detection reads. ASCII "..." (not "…") to keep the folded form a clean URL.
// Raw URLs are never logged or persisted: this is a pure string transform.
const URL_FOLD_THRESHOLD = 60;

function compressUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s]+/g, (url) => {
    if (url.length <= URL_FOLD_THRESHOLD) return url;
    const host = /^(https?:\/\/[^/\s]+)/.exec(url);
    return host ? `${host[1]}/...` : url;
  });
}

// Idempotent RFC2047 decode for header values (Subject/From). Only the
// =?charset?B|Q?text?= pattern is touched, so a header Gmail already returned
// decoded passes through unchanged. Known negligible edge: a legitimate header
// whose literal text is itself shaped like =?...?= would be mis-decoded — not
// handled (vanishingly rare in real mail).
function decodeEncodedWords(input: string): string {
  return input.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, charset, enc, text) => {
      try {
        let bytes: Buffer;
        if (enc.toUpperCase() === "B") {
          bytes = Buffer.from(text, "base64");
        } else {
          const q = (text as string)
            .replace(/_/g, " ")
            .replace(/=([0-9A-Fa-f]{2})/g, (_m, h) =>
              String.fromCharCode(parseInt(h, 16)),
            );
          bytes = Buffer.from(q, "latin1");
        }
        return new TextDecoder(normalizeCharset(charset)).decode(bytes);
      } catch {
        return whole;
      }
    },
  );
}

// True for attachment parts we must never inline (we don't fetch attachmentId).
function isAttachment(part: GmailMessagePart): boolean {
  return Boolean(
    (part.filename && part.filename.length > 0) || part.body?.attachmentId,
  );
}

// Depth-first search for the first non-attachment leaf of the given MIME type
// that actually carries inline data. Returns the part (not just its data) so
// the caller can read its per-part charset.
function findFirstPart(
  part: GmailMessagePart | undefined,
  mimeType: string,
): GmailMessagePart | null {
  if (!part) return null;
  if (
    part.mimeType === mimeType &&
    !isAttachment(part) &&
    typeof part.body?.data === "string"
  ) {
    return part;
  }
  if (part.parts) {
    for (const child of part.parts) {
      const found = findFirstPart(child, mimeType);
      if (found !== null) return found;
    }
  }
  return null;
}

function decodePart(part: GmailMessagePart): string {
  return decodeBase64Url(part.body?.data ?? "", partCharset(part));
}

const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/gi, " "],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#0*39;/gi, "'"],
  [/&apos;/gi, "'"],
  // &amp; LAST so "&amp;lt;" → "&lt;" (literal), not "<".
  [/&amp;/gi, "&"],
];

export function htmlToText(html: string): string {
  let text = html;
  // Drop script/style blocks entirely — their content is not body text and
  // would pollute the lever-analysis input with noise.
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  // Strip all remaining tags.
  text = text.replace(/<[^>]+>/g, " ");
  // Decode the minimal entity set (covers &amp; breaking URLs etc.).
  for (const [pat, rep] of ENTITIES) text = text.replace(pat, rep);
  // Collapse whitespace.
  return text.replace(/\s+/g, " ").trim();
}

function extractBody(payload: GmailMessagePart | undefined): string {
  const plain = findFirstPart(payload, "text/plain");
  if (plain !== null) return compressUrls(decodePart(plain));
  const html = findFirstPart(payload, "text/html");
  if (html !== null) return compressUrls(htmlToText(decodePart(html)));
  return "";
}

export function parseMessage(message: GmailMessageFull): ParsedMessage {
  const headers = message.payload?.headers;
  const from = decodeEncodedWords(headerValue(headers, "From"));
  const subject = decodeEncodedWords(headerValue(headers, "Subject"));

  const authJoined = headerValues(headers, "Authentication-Results").join("\n");
  const rawBody = extractBody(message.payload);

  const truncated = rawBody.length > MAX_MESSAGE_LENGTH;
  const body = truncated ? rawBody.slice(0, MAX_MESSAGE_LENGTH) : rawBody;

  const authTruncated = authJoined.length > MAX_AUTH_LENGTH;
  const authenticationResults = authTruncated
    ? authJoined.slice(0, MAX_AUTH_LENGTH)
    : authJoined;

  return { from, subject, body, authenticationResults, truncated, authTruncated };
}

export function summarizeMessage(message: GmailMessageFull): MessageSummary {
  const headers = message.payload?.headers;
  return {
    id: message.id ?? "",
    from: headerValue(headers, "From"),
    subject: headerValue(headers, "Subject"),
    date: headerValue(headers, "Date"),
    snippet: message.snippet ?? "",
  };
}

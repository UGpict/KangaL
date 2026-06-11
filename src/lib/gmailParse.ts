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

function decodeBase64Url(data: string): string {
  // Gmail uses base64url (-_). Node's "base64url" handles missing padding.
  return Buffer.from(data, "base64url").toString("utf8");
}

// True for attachment parts we must never inline (we don't fetch attachmentId).
function isAttachment(part: GmailMessagePart): boolean {
  return Boolean(
    (part.filename && part.filename.length > 0) || part.body?.attachmentId,
  );
}

// Depth-first search for the first non-attachment leaf of the given MIME type
// that actually carries inline data.
function findFirstPart(
  part: GmailMessagePart | undefined,
  mimeType: string,
): string | null {
  if (!part) return null;
  if (
    part.mimeType === mimeType &&
    !isAttachment(part) &&
    typeof part.body?.data === "string"
  ) {
    return part.body.data;
  }
  if (part.parts) {
    for (const child of part.parts) {
      const found = findFirstPart(child, mimeType);
      if (found !== null) return found;
    }
  }
  return null;
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
  if (plain !== null) return decodeBase64Url(plain);
  const html = findFirstPart(payload, "text/html");
  if (html !== null) return htmlToText(decodeBase64Url(html));
  return "";
}

export function parseMessage(message: GmailMessageFull): ParsedMessage {
  const headers = message.payload?.headers;
  const from = headerValue(headers, "From");
  const subject = headerValue(headers, "Subject");

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

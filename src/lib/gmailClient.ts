// Pure, browser-and-node-testable helpers for the G3 Gmail intake UI. No React,
// no fetch, no I/O — only the mappings that decide what the user sees:
//   - sample/Gmail messages → a single ActiveMessage shape (convergence onto the
//     existing /api/judge gate; "別ルートを作らない" の自然な帰結)
//   - HTTP failures → human-readable Japanese (never a raw machine code)
//   - truncation flags → a short "一部省略" note
// The component layer does the fetching; this module only reshapes/labels.

import type { MessageSummary, ParsedMessage } from "@/lib/gmailParse";

// The currently-viewed message, regardless of origin. Sample fixtures and real
// Gmail messages collapse to this one type so the reading pane + judge POST +
// VerdictCard are shared unchanged.
export type ActiveMessage = {
  id: string;
  source: "sample" | "gmail";
  from: string;
  subject: string;
  receivedAt: string;
  body: string;
  authenticationResults?: string;
  truncated?: boolean;
  authTruncated?: boolean;
};

// Namespace real Gmail message ids so they can never collide with sample ids in
// the shared cache / decisions maps (実運用堅牢性: 衝突回避).
export const GMAIL_ID_PREFIX = "gmail:";

export function gmailActiveId(gmailId: string): string {
  return `${GMAIL_ID_PREFIX}${gmailId}`;
}

export function isGmailActiveId(id: string): boolean {
  return id.startsWith(GMAIL_ID_PREFIX);
}

// Build an ActiveMessage from a list summary + the full parsed detail. The
// detail's from/subject are RFC2047-decoded (gmailParse), so prefer them; fall
// back to the metadata summary if a detail header was empty.
export function detailToActive(
  gmailId: string,
  summary: Pick<MessageSummary, "from" | "subject" | "date">,
  detail: ParsedMessage,
): ActiveMessage {
  const auth = detail.authenticationResults.trim();
  return {
    id: gmailActiveId(gmailId),
    source: "gmail",
    from: detail.from || summary.from,
    subject: detail.subject || summary.subject,
    receivedAt: summary.date,
    body: detail.body,
    authenticationResults: auth.length > 0 ? auth : undefined,
    truncated: detail.truncated,
    authTruncated: detail.authTruncated,
  };
}

// Small note shown when the intake clamped the body or auth header before
// handing it to the existing /api/judge guard.
export function truncationNotice(
  truncated: boolean | undefined,
  authTruncated: boolean | undefined,
): string | null {
  if (truncated || authTruncated) {
    return "長文のため一部を省略して判定します";
  }
  return null;
}

// Live API failures (status/messages/detail). 401 means the ~1h access token
// expired or was revoked — a normal, expected state that routes the user back
// to re-authorization (treated as 正常系, per G1's online/no-refresh design).
export type GmailErrorKind = "reconnect" | "rate_limited" | "upstream" | "network";

// status === null = fetch threw / no response (network or parse failure).
export function classifyGmailError(status: number | null): GmailErrorKind {
  if (status === null) return "network";
  if (status === 401) return "reconnect";
  if (status === 429) return "rate_limited";
  return "upstream"; // 5xx and any other non-OK status → generic upstream
}

const GMAIL_ERROR_MESSAGE: Record<GmailErrorKind, string> = {
  reconnect: "連携が切れています。再連携してください。",
  rate_limited:
    "アクセスが集中しています。少し時間をおいて再度お試しください。",
  upstream: "Gmail との通信に失敗しました。時間をおいて再度お試しください。",
  network: "通信に失敗しました。接続を確認のうえ再度お試しください。",
};

export function gmailErrorMessage(kind: GmailErrorKind): string {
  return GMAIL_ERROR_MESSAGE[kind];
}

// Map the whitelisted callback error codes (?gmail_error=<code>) to human text.
// The codes themselves are fixed strings set by /api/gmail/callback; we never
// surface the raw code to the user.
export function callbackErrorMessage(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "access_denied":
      return "連携がキャンセルされました。もう一度お試しください。";
    case "not_configured":
    case "session_unavailable":
      return "現在 Gmail 連携を利用できません。時間をおいて再度お試しください。";
    default:
      // state_mismatch / missing_code / exchange_failed / 未知コード
      return "連携に失敗しました。もう一度お試しください。";
  }
}

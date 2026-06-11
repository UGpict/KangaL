// Minimal Gmail REST client (read-only). Direct fetch — no googleapis. Only
// GET endpoints are reachable from here; no modify/send/trash code exists. The
// access token is passed as a Bearer header and is NEVER logged or returned in
// any error value.

import {
  summarizeMessage,
  type GmailMessageFull,
  type MessageSummary,
} from "@/lib/gmailParse";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const INBOX_MAX = 10;

// Error codes are machine-readable only; no upstream body / token is attached.
export type GmailApiError =
  | { kind: "unauthorized" } // 401 — token expired/revoked → re-auth
  | { kind: "upstream"; status: number }; // 429/5xx etc. — pass status through

export type GmailApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: GmailApiError };

async function gmailGet(
  token: string,
  path: string,
): Promise<GmailApiResult<unknown>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, error: { kind: "upstream", status: 502 } };
  }
  if (res.status === 401) {
    return { ok: false, error: { kind: "unauthorized" } };
  }
  if (!res.ok) {
    return { ok: false, error: { kind: "upstream", status: res.status } };
  }
  try {
    return { ok: true, value: await res.json() };
  } catch {
    return { ok: false, error: { kind: "upstream", status: 502 } };
  }
}

type MessageListEntry = { id?: string };
type MessageListResponse = { messages?: MessageListEntry[] };

// Lists the most recent inbox messages as lightweight summaries. Two-stage:
// list returns only IDs, then each is fetched with format=metadata so the list
// view never carries message bodies over the wire.
export async function listInbox(
  token: string,
): Promise<GmailApiResult<MessageSummary[]>> {
  const listed = await gmailGet(
    token,
    `/messages?labelIds=INBOX&maxResults=${INBOX_MAX}`,
  );
  if (!listed.ok) return listed;

  const ids = ((listed.value as MessageListResponse).messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string");

  const summaries: MessageSummary[] = [];
  for (const id of ids) {
    const meta = await gmailGet(
      token,
      `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    );
    if (!meta.ok) return meta;
    summaries.push(summarizeMessage(meta.value as GmailMessageFull));
  }
  return { ok: true, value: summaries };
}

// Fetches one message in full (format=full) for parsing. Body parsing happens
// in gmailParse — this only does the network round-trip.
export async function getMessageFull(
  token: string,
  id: string,
): Promise<GmailApiResult<GmailMessageFull>> {
  const result = await gmailGet(
    token,
    `/messages/${encodeURIComponent(id)}?format=full`,
  );
  if (!result.ok) return result;
  return { ok: true, value: result.value as GmailMessageFull };
}

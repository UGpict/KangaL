import { afterEach, describe, expect, it, vi } from "vitest";
import { getMessageFull, listInbox } from "@/lib/gmailApi";

const TOKEN = "ya29.SECRET-token-do-not-leak";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("listInbox", () => {
  it("lists ids then fetches each as metadata summaries", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ messages: [{ id: "a" }, { id: "b" }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "a",
          snippet: "snip a",
          payload: {
            headers: [
              { name: "From", value: "x@a.com" },
              { name: "Subject", value: "Sub A" },
              { name: "Date", value: "D1" },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "b",
          snippet: "snip b",
          payload: { headers: [{ name: "Subject", value: "Sub B" }] },
        }),
      );

    const result = await listInbox(TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]).toEqual({
        id: "a",
        from: "x@a.com",
        subject: "Sub A",
        date: "D1",
        snippet: "snip a",
      });
    }
    // list call uses labelIds=INBOX and metadata format on the detail calls.
    expect(String(fetchMock.mock.calls[0][0])).toContain("labelIds=INBOX");
    expect(String(fetchMock.mock.calls[1][0])).toContain("format=metadata");
    // token rides in the Authorization header, not the URL.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain(TOKEN);
    }
  });

  it("maps 401 to an unauthorized error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "invalid" }, 401),
    );
    const result = await listInbox(TOKEN);
    expect(result).toEqual({ ok: false, error: { kind: "unauthorized" } });
  });

  it("passes through a 429 status without leaking the body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "rate" }, 429),
    );
    const result = await listInbox(TOKEN);
    expect(result).toEqual({
      ok: false,
      error: { kind: "upstream", status: 429 },
    });
  });
});

describe("getMessageFull", () => {
  it("requests format=full and returns the raw message", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ id: "m1", payload: { mimeType: "text/plain" } }),
    );
    const result = await getMessageFull(TOKEN, "m1");
    expect(result.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain("format=full");
  });

  it("maps a 503 to an upstream error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({}, 503),
    );
    const result = await getMessageFull(TOKEN, "m1");
    expect(result).toEqual({
      ok: false,
      error: { kind: "upstream", status: 503 },
    });
  });

  it("returns an upstream error when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("net"));
    const result = await getMessageFull(TOKEN, "m1");
    expect(result.ok).toBe(false);
  });
});

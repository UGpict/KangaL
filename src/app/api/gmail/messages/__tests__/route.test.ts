import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";
import { encryptSession } from "@/lib/gmailSession";

const TOKEN = "ya29.SECRET-token-must-not-leak";
let savedKey: string | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authedRequest(): Request {
  const cookie = encryptSession({
    accessToken: TOKEN,
    expiresAt: Date.now() + 3600_000,
  })!;
  return new Request("http://localhost:3000/api/gmail/messages", {
    headers: { cookie: `gmail_session=${cookie}` },
  });
}

beforeEach(() => {
  savedKey = process.env.GMAIL_SESSION_KEY;
  process.env.GMAIL_SESSION_KEY = Buffer.alloc(32, 4).toString("base64");
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.GMAIL_SESSION_KEY;
  else process.env.GMAIL_SESSION_KEY = savedKey;
  vi.restoreAllMocks();
});

describe("/api/gmail/messages", () => {
  it("returns 401 connected:false with no session and never calls Gmail", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await GET(
      new Request("http://localhost:3000/api/gmail/messages"),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ connected: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns inbox summaries for a valid session without leaking the token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: "a" }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "a",
          snippet: "hi",
          payload: { headers: [{ name: "Subject", value: "Sub" }] },
        }),
      );

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body).messages[0].subject).toBe("Sub");
    expect(body).not.toContain(TOKEN);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain(TOKEN);
    }
  });

  it("maps an upstream 401 to connected:false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 401));
    const res = await GET(authedRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ connected: false });
  });

  it("passes a 429 status through", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 429));
    const res = await GET(authedRequest());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("gmail_upstream");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";
import { encryptSession } from "@/lib/gmailSession";

const TOKEN = "ya29.SECRET-token-must-not-leak";
const BODY_TEXT = "Please verify your account now";
let savedKey: string | undefined;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function authedRequest(): Request {
  const cookie = encryptSession({
    accessToken: TOKEN,
    expiresAt: Date.now() + 3600_000,
  })!;
  return new Request("http://localhost:3000/api/gmail/messages/m1", {
    headers: { cookie: `gmail_session=${cookie}` },
  });
}

beforeEach(() => {
  savedKey = process.env.GMAIL_SESSION_KEY;
  process.env.GMAIL_SESSION_KEY = Buffer.alloc(32, 6).toString("base64");
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.GMAIL_SESSION_KEY;
  else process.env.GMAIL_SESSION_KEY = savedKey;
  vi.restoreAllMocks();
});

describe("/api/gmail/messages/[id]", () => {
  it("returns 401 connected:false with no session", async () => {
    const res = await GET(
      new Request("http://localhost:3000/api/gmail/messages/m1"),
      ctx("m1"),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ connected: false });
  });

  it("parses a message into the judge input shape without leaking the token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        id: "m1",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "evil@phish.test" },
            { name: "Subject", value: "Urgent" },
            { name: "Authentication-Results", value: "spf=fail" },
          ],
          body: { data: b64(BODY_TEXT) },
        },
      }),
    );

    const res = await GET(authedRequest(), ctx("m1"));
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body).toEqual({
      from: "evil@phish.test",
      subject: "Urgent",
      body: BODY_TEXT,
      authenticationResults: "spf=fail",
      truncated: false,
      authTruncated: false,
    });
    expect(text).not.toContain(TOKEN);
  });

  it("maps an upstream 401 to connected:false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 401));
    const res = await GET(authedRequest(), ctx("m1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ connected: false });
  });

  it("passes a 500 status through", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 500));
    const res = await GET(authedRequest(), ctx("m1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("gmail_upstream");
  });
});

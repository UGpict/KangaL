import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../route";
import { SESSION_COOKIE, encryptSession } from "@/lib/gmailSession";

const SECRET_TOKEN = "ya29.SECRET-must-not-leak";
let savedKey: string | undefined;

function statusRequest(cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost:3000/api/gmail/status", { headers });
}

beforeEach(() => {
  savedKey = process.env.GMAIL_SESSION_KEY;
  process.env.GMAIL_SESSION_KEY = Buffer.alloc(32, 8).toString("base64");
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.GMAIL_SESSION_KEY;
  else process.env.GMAIL_SESSION_KEY = savedKey;
});

describe("/api/gmail/status", () => {
  it("reports disconnected when there is no cookie", async () => {
    const res = await GET(statusRequest());
    expect(await res.json()).toEqual({ connected: false });
  });

  it("reports connected with expiry for a valid session, without the token", async () => {
    const expiresAt = Date.now() + 3600_000;
    const blob = encryptSession({ accessToken: SECRET_TOKEN, expiresAt })!;
    const res = await GET(statusRequest(`${SESSION_COOKIE}=${blob}`));
    const body = await res.json();
    expect(body).toEqual({ connected: true, expiresAt });
    expect(JSON.stringify(body)).not.toContain(SECRET_TOKEN);
  });

  it("reports disconnected for an expired session", async () => {
    const blob = encryptSession({
      accessToken: SECRET_TOKEN,
      expiresAt: Date.now() - 1000,
    })!;
    const res = await GET(statusRequest(`${SESSION_COOKIE}=${blob}`));
    expect(await res.json()).toEqual({ connected: false });
  });

  it("reports disconnected for a tampered/garbage cookie", async () => {
    const res = await GET(statusRequest(`${SESSION_COOKIE}=garbage.value.here`));
    expect(await res.json()).toEqual({ connected: false });
  });
});

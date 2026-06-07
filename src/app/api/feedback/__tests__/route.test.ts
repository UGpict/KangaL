import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../route";
import {
  clearUserVerdict,
  listUserVerdicts,
  recordUserVerdict,
} from "@/lib/feedbackWriter";
import { SAMPLE_MESSAGES } from "@/lib/sampleMessages";

vi.mock("@/lib/feedbackWriter", () => ({
  recordUserVerdict: vi.fn(),
  clearUserVerdict: vi.fn(),
  listUserVerdicts: vi.fn(),
}));

const KNOWN_ID = SAMPLE_MESSAGES[0].id;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/feedback POST", () => {
  it("writes a decision for a known sampleMessages id", async () => {
    vi.mocked(recordUserVerdict).mockResolvedValue();
    const res = await POST(makeRequest({ id: KNOWN_ID, decision: "reported" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(recordUserVerdict).toHaveBeenCalledWith(KNOWN_ID, "reported");
  });

  it("rejects an unknown id without touching the writer (no collection pollution)", async () => {
    const res = await POST(
      makeRequest({ id: "msg-does-not-exist", decision: "reported" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown_id");
    expect(recordUserVerdict).not.toHaveBeenCalled();
    expect(clearUserVerdict).not.toHaveBeenCalled();
  });

  it("rejects a missing/non-string id", async () => {
    const res = await POST(makeRequest({ decision: "reported" }));
    expect(res.status).toBe(400);
    expect(recordUserVerdict).not.toHaveBeenCalled();
  });

  it("rejects an invalid decision value", async () => {
    const res = await POST(makeRequest({ id: KNOWN_ID, decision: "approve" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_decision");
    expect(recordUserVerdict).not.toHaveBeenCalled();
  });

  it("treats decision:null as an undo (deletes the doc)", async () => {
    vi.mocked(clearUserVerdict).mockResolvedValue();
    const res = await POST(makeRequest({ id: KNOWN_ID, decision: null }));
    expect(res.status).toBe(200);
    expect(clearUserVerdict).toHaveBeenCalledWith(KNOWN_ID);
    expect(recordUserVerdict).not.toHaveBeenCalled();
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(recordUserVerdict).not.toHaveBeenCalled();
  });

  it("(M1) returns 413 and never writes when the body exceeds the byte cap", async () => {
    const res = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: KNOWN_ID, pad: "x".repeat(70 * 1024) }),
      }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("payload_too_large");
    expect(recordUserVerdict).not.toHaveBeenCalled();
  });

  it("returns 500 when the writer throws", async () => {
    vi.mocked(recordUserVerdict).mockRejectedValue(new Error("no creds"));
    const res = await POST(makeRequest({ id: KNOWN_ID, decision: "marked_safe" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("persist_failed");
  });
});

describe("/api/feedback GET", () => {
  it("returns the persisted verdict map", async () => {
    vi.mocked(listUserVerdicts).mockResolvedValue({ [KNOWN_ID]: "reported" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).verdicts).toEqual({ [KNOWN_ID]: "reported" });
  });

  it("degrades to an empty map when the store is unreachable", async () => {
    vi.mocked(listUserVerdicts).mockRejectedValue(new Error("no creds"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).verdicts).toEqual({});
  });
});

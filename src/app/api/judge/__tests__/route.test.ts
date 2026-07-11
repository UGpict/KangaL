import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";
import { analyzeStructure } from "@/agents/analyzeStructure";
import { investigate } from "@/agents/investigate";
import { judge } from "@/agents/judge";
import {
  JUDGE_RATE_LIMIT,
  __resetJudgeRateLimiterForTests,
} from "@/lib/rateLimit";
import type { AttackPattern } from "@/types/attackPattern";

vi.mock("@/agents/analyzeStructure", () => ({
  analyzeStructure: vi.fn(),
}));
vi.mock("@/agents/investigate", () => ({
  investigate: vi.fn(),
}));
vi.mock("@/agents/judge", () => ({
  judge: vi.fn(),
}));

const NEUTRAL_LEVERS: AttackPattern["levers"] = {
  urgency: { tactic: "none", intensity: 0 },
  authority: { impersonates: "none", credibilityTricks: [] },
  incentive: { type: "reward", hook: "prize", intensity: 0 },
  callToAction: { action: "click_link", friction: "high" },
  personalization: { level: "broadcast", signals: [] },
  isolation: { tactic: "none", intensity: 0 },
};

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/judge", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The judge rate limiter is a module singleton — without this reset the
  // POSTs issued by earlier tests would trip the limit in later ones.
  __resetJudgeRateLimiterForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/api/judge route", () => {
  it("(M8) when analyzeStructure returns degraded:true, neither investigate nor judge runs and the response is { degraded: true }", async () => {
    vi.mocked(analyzeStructure).mockResolvedValue({
      levers: NEUTRAL_LEVERS,
      degraded: true,
    });

    const response = await POST(makeRequest({ message: "anything" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ degraded: true });
    expect(analyzeStructure).toHaveBeenCalledOnce();
    // The whole point of this test — the short-circuit must skip both
    // downstream calls so a failed analysis can't burn the investigation
    // budget on placeholder lever values.
    expect(investigate).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
  });

  it("(M8) on the happy path, all three agents are called and the response carries the verdict + investigation", async () => {
    vi.mocked(analyzeStructure).mockResolvedValue({
      levers: NEUTRAL_LEVERS,
      degraded: false,
    });
    vi.mocked(investigate).mockResolvedValue({
      truncated: false,
      truncatedReason: null,
      bonus: { items: [], total: 0, capped: false },
    });
    vi.mocked(judge).mockResolvedValue({
      score: 42,
      reason: "test reason",
      isolationNote: null,
      investigationBonus: { items: [], total: 0, capped: false },
    });

    const response = await POST(
      makeRequest({ message: "hello", authenticationResults: "spf=pass" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.degraded).toBe(false);
    expect(body.score).toBe(42);
    expect(body.reason).toBe("test reason");
    expect(analyzeStructure).toHaveBeenCalledOnce();
    expect(investigate).toHaveBeenCalledOnce();
    expect(judge).toHaveBeenCalledOnce();
    // authenticationResults is forwarded through to investigate.
    expect(vi.mocked(investigate).mock.calls[0][0].authenticationResults).toBe(
      "spf=pass",
    );
  });

  it("returns 400 when message is missing", async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    expect(analyzeStructure).not.toHaveBeenCalled();
  });

  it("returns 400 when the JSON body is malformed", async () => {
    const response = await POST(
      new Request("http://localhost/api/judge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(response.status).toBe(400);
    expect(analyzeStructure).not.toHaveBeenCalled();
  });

  it("(G1) rejects an over-length authenticationResults before judging (closes the 8000 bypass)", async () => {
    const response = await POST(
      makeRequest({ message: "hi", authenticationResults: "a".repeat(4001) }),
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe("authentication_results_too_long");
    expect(analyzeStructure).not.toHaveBeenCalled();
  });

  it("(M1) returns 413 and never parses when the body exceeds the byte cap", async () => {
    const response = await POST(
      new Request("http://localhost/api/judge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // > 64KB of JSON — read is cut off before reaching the agents.
        body: JSON.stringify({ message: "x".repeat(70 * 1024) }),
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(413);
    expect(body.error).toBe("payload_too_large");
    expect(analyzeStructure).not.toHaveBeenCalled();
  });
});

describe("/api/judge rate limiting", () => {
  function mockHappyPath() {
    vi.mocked(analyzeStructure).mockResolvedValue({
      levers: NEUTRAL_LEVERS,
      degraded: false,
    });
    vi.mocked(investigate).mockResolvedValue({
      truncated: false,
      truncatedReason: null,
      bonus: { items: [], total: 0, capped: false },
    });
    vi.mocked(judge).mockResolvedValue({
      score: 42,
      reason: "test reason",
      isolationNote: null,
      investigationBonus: { items: [], total: 0, capped: false },
    });
  }

  async function exhaust(ip: string): Promise<void> {
    for (let i = 0; i < JUDGE_RATE_LIMIT.perClientLimit; i++) {
      const response = await POST(
        makeRequest({ message: "hello" }, { "x-forwarded-for": ip }),
      );
      expect(response.status).toBe(200);
    }
  }

  it("returns 429 with Retry-After once a client exceeds its window, without reading the body", async () => {
    mockHappyPath();
    await exhaust("203.0.113.7");

    const callsBefore = vi.mocked(analyzeStructure).mock.calls.length;
    const response = await POST(
      makeRequest({ message: "hello" }, { "x-forwarded-for": "203.0.113.7" }),
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({ error: "rate_limited" });
    const retryAfter = Number(response.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    // Short-circuits before body parsing and before any agent runs.
    expect(vi.mocked(analyzeStructure).mock.calls.length).toBe(callsBefore);
  });

  it("keeps serving other clients while one is limited", async () => {
    mockHappyPath();
    await exhaust("203.0.113.7");

    const limited = await POST(
      makeRequest({ message: "hello" }, { "x-forwarded-for": "203.0.113.7" }),
    );
    expect(limited.status).toBe(429);

    const other = await POST(
      makeRequest({ message: "hello" }, { "x-forwarded-for": "198.51.100.9" }),
    );
    expect(other.status).toBe(200);
  });

  it("lets a limited client through again after the window elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00Z"));
    mockHappyPath();
    await exhaust("203.0.113.7");

    const limited = await POST(
      makeRequest({ message: "hello" }, { "x-forwarded-for": "203.0.113.7" }),
    );
    expect(limited.status).toBe(429);

    vi.setSystemTime(
      new Date(Date.now() + JUDGE_RATE_LIMIT.windowMs),
    );
    const recovered = await POST(
      makeRequest({ message: "hello" }, { "x-forwarded-for": "203.0.113.7" }),
    );
    expect(recovered.status).toBe(200);
  });
});

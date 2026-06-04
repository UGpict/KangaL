import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";
import { analyzeStructure } from "@/agents/analyzeStructure";
import { investigate } from "@/agents/investigate";
import { judge } from "@/agents/judge";
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

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
});

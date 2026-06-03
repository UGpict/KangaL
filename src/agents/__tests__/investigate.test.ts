import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackPattern } from "@/types/attackPattern";
import { exampleAttackPattern } from "@/types/__fixtures__/attackPattern.example";

// Mock the gemini wrapper — we control which tools the "model" routes to.
vi.mock("@/lib/gemini", () => ({
  generateWithTools: vi.fn(),
}));

// Mock each leaf tool — we verify call/no-call and pin return values.
vi.mock("@/tools/checkUrlReputation", () => ({
  checkUrlReputation: vi.fn(),
}));
vi.mock("@/tools/checkDomainAge", () => ({
  checkDomainAge: vi.fn(),
}));
vi.mock("@/tools/verifySenderAuth", () => ({
  verifySenderAuth: vi.fn(),
}));
vi.mock("@/tools/matchKnownScams", () => ({
  matchKnownScams: vi.fn(),
}));
vi.mock("@/tools/checkOfficialAlerts", () => ({
  checkOfficialAlerts: vi.fn(),
}));

import { generateWithTools } from "@/lib/gemini";
import { checkDomainAge } from "@/tools/checkDomainAge";
import { checkOfficialAlerts } from "@/tools/checkOfficialAlerts";
import { checkUrlReputation } from "@/tools/checkUrlReputation";
import { matchKnownScams } from "@/tools/matchKnownScams";
import { verifySenderAuth } from "@/tools/verifySenderAuth";
import { investigate, TOOL_DECLARATIONS } from "../investigate";

const BASE_LEVERS: AttackPattern["levers"] = exampleAttackPattern.levers;

// Defaults that each test can override via vi.mocked(...).mockResolvedValueOnce.
function pinDefaultToolResponses() {
  vi.mocked(matchKnownScams).mockResolvedValue({ ok: true, matches: [] });
  vi.mocked(checkUrlReputation).mockResolvedValue({
    ok: true,
    url: "https://example.com",
    threats: [],
  });
  vi.mocked(checkDomainAge).mockResolvedValue({
    ok: true,
    domain: "example.com",
    registeredAt: "2020-01-01",
    ageDays: 1000,
  });
  vi.mocked(verifySenderAuth).mockResolvedValue({
    ok: true,
    spf: "pass",
    dkim: "pass",
    dmarc: "pass",
    raw: "spf=pass dkim=pass dmarc=pass",
  });
  vi.mocked(checkOfficialAlerts).mockResolvedValue({ ok: true, matches: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  pinDefaultToolResponses();
});

describe("investigate (dynamic routing)", () => {
  it("(a) when the message contains a URL, checkUrlReputation is invoked with that URL", async () => {
    // Simulated Gemini: chooses matchKnownScams + checkUrlReputation.
    vi.mocked(generateWithTools).mockImplementation(async (input) => {
      await input.executors.matchKnownScams({
        name: "matchKnownScams",
        args: {},
      });
      await input.executors.checkUrlReputation({
        name: "checkUrlReputation",
        args: { url: "https://bad.example/login" },
      });
      return { text: "done", turns: 2, truncated: false, toolCalls: [] };
    });

    const report = await investigate({
      message: "急ぎで https://bad.example/login にアクセスしてください",
      levers: BASE_LEVERS,
    });

    expect(checkUrlReputation).toHaveBeenCalledWith({
      url: "https://bad.example/login",
    });
    expect(matchKnownScams).toHaveBeenCalledWith({ levers: BASE_LEVERS });
    expect(report.urlReputation?.status).toBe("ok");
    expect(report.truncated).toBe(false);
  });

  it("(b) when no URL is in the input, the model does not route to checkUrlReputation", async () => {
    vi.mocked(generateWithTools).mockImplementation(async (input) => {
      // Only matchKnownScams — no URL means no checkUrlReputation call.
      await input.executors.matchKnownScams({
        name: "matchKnownScams",
        args: {},
      });
      return { text: "done", turns: 1, truncated: false, toolCalls: [] };
    });

    await investigate({
      message: "来週の定例の議題ですが、いつもどおりで大丈夫でしょうか",
      levers: BASE_LEVERS,
    });

    expect(checkUrlReputation).not.toHaveBeenCalled();
    expect(matchKnownScams).toHaveBeenCalledOnce();
  });

  it("(c) a tool that returns ok:false does not stop the investigation — the finding is recorded as error", async () => {
    vi.mocked(checkUrlReputation).mockResolvedValueOnce({
      ok: false,
      reason: "missing_api_key",
    });
    vi.mocked(generateWithTools).mockImplementation(async (input) => {
      await input.executors.matchKnownScams({
        name: "matchKnownScams",
        args: {},
      });
      await input.executors.checkUrlReputation({
        name: "checkUrlReputation",
        args: { url: "https://x.example" },
      });
      return { text: "done", turns: 2, truncated: false, toolCalls: [] };
    });

    const report = await investigate({
      message: "https://x.example",
      levers: BASE_LEVERS,
    });

    expect(report.urlReputation).toEqual({
      status: "error",
      errorMessage: "missing_api_key",
    });
    expect(report.knownScams?.status).toBe("ok");
    expect(report.truncated).toBe(false);
  });

  it("(d) when the total budget is exceeded, investigate returns the partial report with truncated:true", async () => {
    vi.mocked(generateWithTools).mockImplementation(async (input) => {
      // Fast call: matchKnownScams completes before the budget timer.
      await input.executors.matchKnownScams({
        name: "matchKnownScams",
        args: {},
      });
      // Then "Gemini" hangs longer than the budget allows.
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { text: "would have summarized", turns: 4, truncated: false, toolCalls: [] };
    });

    const start = Date.now();
    const report = await investigate({
      message: "anything",
      levers: BASE_LEVERS,
      budgetMs: 50,
    });
    const elapsed = Date.now() - start;

    expect(report.truncated).toBe(true);
    expect(report.knownScams?.status).toBe("ok");
    expect(report.urlReputation).toBeUndefined();
    // Returned roughly within the budget (plus a small grace window).
    expect(elapsed).toBeLessThan(180);
  });

  it("matchKnownScams executor uses input.levers from closure regardless of args", async () => {
    vi.mocked(generateWithTools).mockImplementation(async (input) => {
      // Gemini calls with extraneous args — they should be ignored.
      await input.executors.matchKnownScams({
        name: "matchKnownScams",
        args: { spurious: "ignored" },
      });
      return { text: "done", turns: 1, truncated: false, toolCalls: [] };
    });

    await investigate({ message: "msg", levers: BASE_LEVERS });

    expect(matchKnownScams).toHaveBeenCalledWith({ levers: BASE_LEVERS });
  });

  it("verifySenderAuth hallucination guard: empty args fall back to input.authenticationResults", async () => {
    vi.mocked(generateWithTools).mockImplementation(async (input) => {
      await input.executors.matchKnownScams({
        name: "matchKnownScams",
        args: {},
      });
      // Hallucinated call — no args.
      await input.executors.verifySenderAuth({
        name: "verifySenderAuth",
        args: {},
      });
      return { text: "done", turns: 2, truncated: false, toolCalls: [] };
    });

    await investigate({
      message: "msg",
      levers: BASE_LEVERS,
      authenticationResults: "spf=fail dkim=fail dmarc=fail",
    });

    expect(verifySenderAuth).toHaveBeenCalledWith({
      authenticationResults: "spf=fail dkim=fail dmarc=fail",
    });
  });

  it("verifySenderAuth hallucination guard: no args AND no input.authenticationResults → leaf returns empty_input, finding recorded as error", async () => {
    vi.mocked(verifySenderAuth).mockResolvedValueOnce({
      ok: false,
      reason: "empty_input",
    });
    vi.mocked(generateWithTools).mockImplementation(async (input) => {
      await input.executors.matchKnownScams({
        name: "matchKnownScams",
        args: {},
      });
      await input.executors.verifySenderAuth({
        name: "verifySenderAuth",
        args: {},
      });
      return { text: "done", turns: 2, truncated: false, toolCalls: [] };
    });

    const report = await investigate({
      message: "msg",
      levers: BASE_LEVERS,
      // no authenticationResults
    });

    expect(verifySenderAuth).toHaveBeenCalledWith({ authenticationResults: "" });
    expect(report.senderAuth).toEqual({
      status: "error",
      errorMessage: "empty_input",
    });
  });

  it("when generateWithTools rejects, investigate returns truncated:true rather than throwing", async () => {
    vi.mocked(generateWithTools).mockRejectedValueOnce(
      new Error("vertex unavailable"),
    );

    const report = await investigate({
      message: "msg",
      levers: BASE_LEVERS,
    });

    expect(report.truncated).toBe(true);
    // No findings were collected because generateWithTools rejected before
    // any executor ran.
    expect(report.knownScams).toBeUndefined();
  });

  it("tool declarations include matchKnownScams as the always-call tool and the four conditional tools", () => {
    const names = TOOL_DECLARATIONS.map((d) => d.name);
    expect(names).toEqual([
      "checkUrlReputation",
      "checkDomainAge",
      "verifySenderAuth",
      "matchKnownScams",
      "checkOfficialAlerts",
    ]);
    const mks = TOOL_DECLARATIONS.find((d) => d.name === "matchKnownScams");
    expect(mks?.description).toMatch(/必ず\s*1\s*回/);
    const url = TOOL_DECLARATIONS.find((d) => d.name === "checkUrlReputation");
    // Encodes the "do not call without URL" routing rule.
    expect(url?.description).toMatch(/呼んではいけない|含まれているときだけ/);
  });
});

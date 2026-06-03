import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks need to be hoisted so vi.mock factory can see them.
const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
  },
  // Re-export Type so call sites that import it don't break under the mock.
  Type: {
    OBJECT: "OBJECT",
    STRING: "STRING",
    INTEGER: "INTEGER",
    NUMBER: "NUMBER",
    BOOLEAN: "BOOLEAN",
    ARRAY: "ARRAY",
  },
}));

import {
  generateWithTools,
  type ToolCall,
  type ToolDeclaration,
  type ToolExecutor,
} from "../gemini";

const SAMPLE_TOOL: ToolDeclaration = {
  name: "echo",
  description: "Echo back the input.",
  parameters: {
    type: "OBJECT",
    properties: { value: { type: "STRING" } },
    required: ["value"],
  },
};

function modelTextTurn(text: string) {
  return {
    candidates: [{ content: { role: "model", parts: [{ text }] } }],
  };
}

function modelFunctionCallTurn(name: string, args: Record<string, unknown>) {
  return {
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ functionCall: { name, args } }],
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
});

describe("generateWithTools", () => {
  it("(b) returns text immediately when the model issues no tool calls", async () => {
    mockGenerateContent.mockResolvedValueOnce(modelTextTurn("final answer"));

    const result = await generateWithTools({
      systemInstruction: "sys",
      userText: "hello",
      tools: [SAMPLE_TOOL],
      executors: { echo: vi.fn() as unknown as ToolExecutor },
    });

    expect(result.text).toBe("final answer");
    expect(result.turns).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.toolCalls).toEqual([]);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("(a) tool_call → executor → second-turn text", async () => {
    mockGenerateContent
      .mockResolvedValueOnce(modelFunctionCallTurn("echo", { value: "hi" }))
      .mockResolvedValueOnce(modelTextTurn("got it"));

    const executor = vi.fn(async () => ({ echoed: "hi" }));

    const result = await generateWithTools({
      systemInstruction: "sys",
      userText: "hello",
      tools: [SAMPLE_TOOL],
      executors: { echo: executor },
    });

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith({ name: "echo", args: { value: "hi" } });
    expect(result.text).toBe("got it");
    expect(result.turns).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.toolCalls).toEqual([{ name: "echo", args: { value: "hi" } }]);

    // Second Gemini call should carry: [user(text), model(functionCall), user(functionResponse)]
    const secondCallContents = (mockGenerateContent.mock.calls[1][0] as {
      contents: Array<{ role: string; parts: unknown[] }>;
    }).contents;
    expect(secondCallContents).toHaveLength(3);
    expect(secondCallContents[1].role).toBe("model");
    expect(secondCallContents[2].role).toBe("user");
    const fnRespPart = secondCallContents[2].parts[0] as {
      functionResponse: { name: string; response: Record<string, unknown> };
    };
    expect(fnRespPart.functionResponse.name).toBe("echo");
    expect(fnRespPart.functionResponse.response).toEqual({ echoed: "hi" });
  });

  it("(c) returns truncated:true when maxTurns is exceeded", async () => {
    // Always issue a tool call — never finalize.
    mockGenerateContent.mockResolvedValue(
      modelFunctionCallTurn("echo", { value: "loop" }),
    );
    const executor = vi.fn(async () => ({ ok: true }));

    const result = await generateWithTools({
      systemInstruction: "sys",
      userText: "loop",
      tools: [SAMPLE_TOOL],
      executors: { echo: executor },
      maxTurns: 2,
    });

    expect(result.truncated).toBe(true);
    expect(result.turns).toBe(2);
    expect(result.text).toBe("");
    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.toolCalls).toHaveLength(2);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("(d) when executor throws, error is forwarded as functionResponse and the loop continues", async () => {
    mockGenerateContent
      .mockResolvedValueOnce(modelFunctionCallTurn("echo", { value: "boom" }))
      .mockResolvedValueOnce(modelTextTurn("handled"));

    const executor = vi.fn(async () => {
      throw new Error("tool blew up");
    });

    const result = await generateWithTools({
      systemInstruction: "sys",
      userText: "explode please",
      tools: [SAMPLE_TOOL],
      executors: { echo: executor },
    });

    expect(result.text).toBe("handled");
    expect(result.truncated).toBe(false);

    // The function response sent back to Gemini must encode the error so the
    // model can recover instead of being left in the dark.
    const secondCall = (mockGenerateContent.mock.calls[1][0] as {
      contents: Array<{ role: string; parts: unknown[] }>;
    });
    const responsePart = secondCall.contents[2].parts[0] as {
      functionResponse: { name: string; response: { error?: string } };
    };
    expect(responsePart.functionResponse.name).toBe("echo");
    expect(responsePart.functionResponse.response.error).toContain(
      "tool blew up",
    );
  });

  it("(d') when the model calls an unknown tool, an unknown_tool error is returned and the loop continues", async () => {
    mockGenerateContent
      .mockResolvedValueOnce(
        modelFunctionCallTurn("phantom", { x: 1 }),
      )
      .mockResolvedValueOnce(modelTextTurn("recovered"));

    const result = await generateWithTools({
      systemInstruction: "sys",
      userText: "call phantom",
      tools: [SAMPLE_TOOL],
      executors: {}, // no executor for "phantom"
    });

    expect(result.text).toBe("recovered");

    const secondCall = (mockGenerateContent.mock.calls[1][0] as {
      contents: Array<{ role: string; parts: unknown[] }>;
    });
    const responsePart = secondCall.contents[2].parts[0] as {
      functionResponse: { name: string; response: { error?: string } };
    };
    expect(responsePart.functionResponse.response.error).toContain(
      "unknown_tool: phantom",
    );
  });

  it("records each tool call in toolCalls in chronological order", async () => {
    mockGenerateContent
      .mockResolvedValueOnce(modelFunctionCallTurn("echo", { value: "a" }))
      .mockResolvedValueOnce(modelFunctionCallTurn("echo", { value: "b" }))
      .mockResolvedValueOnce(modelTextTurn("done"));

    const executor = vi.fn(async (call: ToolCall) => ({ echoed: call.args.value }));

    const result = await generateWithTools({
      systemInstruction: "sys",
      userText: "double call",
      tools: [SAMPLE_TOOL],
      executors: { echo: executor },
    });

    expect(result.toolCalls).toEqual([
      { name: "echo", args: { value: "a" } },
      { name: "echo", args: { value: "b" } },
    ]);
    expect(result.turns).toBe(3);
  });
});

import { GoogleGenAI, type Schema } from "@google/genai";

export type GenerateJsonInput = {
  systemInstruction: string;
  userText: string;
  responseSchema: unknown;
  model?: string;
  temperature?: number;
};

export type GenerateJsonResult = {
  text: string;
};

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_LOCATION = "us-central1";

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT env var is required to call Vertex AI Gemini.",
    );
  }
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? DEFAULT_LOCATION;
  cachedClient = new GoogleGenAI({ vertexai: true, project, location });
  return cachedClient;
}

export async function generateJson(
  input: GenerateJsonInput,
): Promise<GenerateJsonResult> {
  const ai = getClient();
  const model = input.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: input.userText }] }],
    config: {
      systemInstruction: input.systemInstruction,
      temperature: input.temperature ?? 0.2,
      responseMimeType: "application/json",
      responseSchema: input.responseSchema as Schema,
    },
  });
  return { text: response.text ?? "" };
}

// ── Function-calling loop ────────────────────────────────────────────────
// generateWithTools drives a multi-turn conversation where Gemini may call
// declared tools. We execute each tool via the injected executor map, feed
// results back as functionResponse parts, and continue until the model
// returns a turn with no tool calls (final text) or we hit maxTurns.
//
// Contract:
// - gemini.ts is tool-agnostic. Caller passes a `tools` declaration list and
//   an `executors` map keyed by tool name. Decoupling lives here.
// - On maxTurns exceeded the loop returns { truncated: true } instead of
//   throwing — callers can still inspect toolCalls / accumulated executor
//   side-effects.
// - When an executor throws or is missing, the error is serialized into the
//   functionResponse for that turn so the model can recover; the loop never
//   crashes on tool failure.
// - executor results are passed to Gemini in-loop; if the caller wants to
//   accumulate them outside the loop, wrap executors with a closure that
//   records results into an external map (see Chunk 2's investigate.ts).

export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: object;
};

export type ToolCall = {
  name: string;
  args: Record<string, unknown>;
};

export type ToolExecutor = (
  call: ToolCall,
) => Promise<Record<string, unknown>>;

export type GenerateWithToolsInput = {
  systemInstruction: string;
  userText: string;
  tools: ToolDeclaration[];
  executors: Record<string, ToolExecutor>;
  model?: string;
  temperature?: number;
  maxTurns?: number;
  // Forwarded to the SDK's generateContent call as `config.abortSignal`.
  // The SDK note says this is a client-side cancel only — the request keeps
  // billing on the server side — but it does free the local promise so we
  // don't burn the caller's budget waiting on a doomed turn.
  signal?: AbortSignal;
};

export type GenerateWithToolsResult = {
  text: string;
  turns: number;
  truncated: boolean;
  toolCalls: ToolCall[];
};

// Single source of truth for the tool-loop ceiling. 6 was picked for the
// investigate orchestrator (5 declared tools × 1 call/turn + 1 summary turn);
// other callers can override per-call. See investigate.ts for the rationale.
export const DEFAULT_MAX_TURNS = 6;

type ConversationPart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
};

type ConversationTurn = {
  role: "user" | "model";
  parts: ConversationPart[];
};

export async function generateWithTools(
  input: GenerateWithToolsInput,
): Promise<GenerateWithToolsResult> {
  const ai = getClient();
  const model = input.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
  const contents: ConversationTurn[] = [
    { role: "user", parts: [{ text: input.userText }] },
  ];
  const toolCalls: ToolCall[] = [];
  // Track the last model turn's parts so that on a truncation exit (maxTurns
  // reached while the model was still calling tools) we can still surface
  // any text it produced in that final turn — see M1.
  let lastParts: ConversationPart[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await ai.models.generateContent({
      model,
      // Our ConversationTurn is structurally compatible with the SDK's
      // Content type for our usage; the cast avoids importing the SDK's
      // wider Content union into this file's public surface.
      contents: contents as never,
      config: {
        systemInstruction: input.systemInstruction,
        temperature: input.temperature ?? 0.2,
        tools: [{ functionDeclarations: input.tools as never }],
        abortSignal: input.signal,
      },
    });

    const candidate = response.candidates?.[0];
    const parts: ConversationPart[] =
      (candidate?.content?.parts as ConversationPart[] | undefined) ?? [];
    lastParts = parts;

    const calls: ToolCall[] = parts
      .filter(
        (p): p is ConversationPart & {
          functionCall: NonNullable<ConversationPart["functionCall"]>;
        } => Boolean(p.functionCall?.name),
      )
      .map((p) => ({
        name: p.functionCall.name,
        args: p.functionCall.args ?? {},
      }));

    if (calls.length === 0) {
      const text = parts
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      return { text, turns: turn + 1, truncated: false, toolCalls };
    }

    toolCalls.push(...calls);

    const responses = await Promise.all(
      calls.map(async (call) => {
        const executor = input.executors[call.name];
        if (!executor) {
          return {
            name: call.name,
            response: {
              error: `unknown_tool: ${call.name}`,
            } as Record<string, unknown>,
          };
        }
        try {
          const result = await executor(call);
          return { name: call.name, response: result };
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return {
            name: call.name,
            response: { error: message } as Record<string, unknown>,
          };
        }
      }),
    );

    // Push the model's turn (verbatim) then our function responses.
    contents.push({ role: "model", parts });
    contents.push({
      role: "user",
      parts: responses.map((r) => ({
        functionResponse: { name: r.name, response: r.response },
      })),
    });
  }

  // M1: preserve any text the model produced in the final (truncated) turn.
  // Previously this was hard-coded to "" and lost the model's intermediate
  // reasoning when truncation fired alongside text.
  const truncatedText = lastParts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  return { text: truncatedText, turns: maxTurns, truncated: true, toolCalls };
}

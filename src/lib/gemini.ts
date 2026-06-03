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

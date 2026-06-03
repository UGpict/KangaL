import { randomUUID } from "node:crypto";

// Wrap externally-sourced text (user input, fetched API payloads) in a
// per-request nonce tag. The nonce defeats boundary-token injection: a
// hostile input that embeds `</untrusted_input>` cannot close our wrapper
// because the closing tag carries an unpredictable suffix only known to us.
// The system instruction must reference the returned `tag` so the model
// knows which boundary to honor.
//
// The wrapper is a labeling boundary, not a content filter — we never modify
// the input text. Defense-in-depth: pair with a system instruction that
// treats anything inside the tag as data, never instructions.
export function wrapUntrusted(text: string): { wrapped: string; tag: string } {
  for (let attempt = 0; attempt < 5; attempt++) {
    const tag = `untrusted_input_${randomUUID()}`;
    if (!text.includes(tag)) {
      return { wrapped: `<${tag}>\n${text}\n</${tag}>`, tag };
    }
  }
  throw new Error("untrusted_input_nonce_collision");
}

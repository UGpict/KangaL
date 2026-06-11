// Shared input-size limits for the /api/judge entry point. Extracted from the
// route so the Gmail import path (G2) can clamp parsed mail to the SAME bounds
// the judge guard enforces, instead of duplicating the magic numbers. The
// guard itself stays in /api/judge — upstream callers just pre-shape input to
// fit through it.

export const MAX_MESSAGE_LENGTH = 8000;

// authenticationResults にも message と同じく長さ上限を掛ける。これが無いと
// message="hi" + 巨大 auth で MAX_MESSAGE_LENGTH ガードを迂回して body を肥大化できる。
export const MAX_AUTH_LENGTH = 4000;

// 公開（allUsers）ルートの body を「読み取り自体」で打ち切るためのヘルパー。
// Content-Length ヘッダを信頼した早期 413 ではなく、ストリームを実バイトで数えて
// 上限超過時点で読み取りを中断する（chunked / Content-Length 詐称に耐えるため）。
// 将来 Cloudflare 等の前段で edge body 上限が入るまでの繋ぎという位置づけ。

const DEFAULT_MAX_BODY_BYTES = 64 * 1024; // 64KB

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: "payload_too_large" | "invalid_json" };

function parse(text: string): BoundedJsonResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<BoundedJsonResult> {
  const body = request.body;

  // body ストリームが取れない環境では text() にフォールバックしつつ、読み切った
  // バイト長で同じ上限を適用する（打ち切りはできないが上限超過は弾ける）。
  if (body === null) {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      return { ok: false, error: "payload_too_large" };
    }
    return parse(text);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return { ok: false, error: "payload_too_large" };
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parse(new TextDecoder().decode(merged));
}

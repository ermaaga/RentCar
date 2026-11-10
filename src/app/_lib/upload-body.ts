// Upload body reader (docs/06-backend-api.md 10.3 step 1): a declared Content-Length over the cap is
// refused before reading; otherwise bytes are counted while streaming and reading stops at the cap, so
// a client that lies about the length cannot make the server buffer more than `maxBytes`.

export type BodyResult = { ok: true; body: Buffer } | { ok: false; reason: "too_large" | "empty" };

export async function readCappedBody(req: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, reason: "too_large" };
  if (!req.body) return { ok: false, reason: "empty" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }
  return total === 0 ? { ok: false, reason: "empty" } : { ok: true, body: Buffer.concat(chunks) };
}

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import { createLimiter, withTimeout } from "../concurrency/limiter";

// ImageProcessor (docs/06-backend-api.md 10.3 steps 2-4, SR-UPL): the real type comes from the magic
// bytes (JPEG, PNG, WebP only; the Content-Type and filename are ignored), decoding is capped at 25 MP,
// one frame, fails on any error, at most 2 uploads at once and 10 s each. EXIF orientation is applied
// and every variant is re-encoded as WebP without metadata; the original is never kept.

export type ImageError = "UPLOAD_UNSUPPORTED_TYPE" | "UPLOAD_DECODE_FAILED";

interface ImageVariant {
  size: number;
  body: Buffer;
  width: number;
  height: number;
}

export type ProcessResult =
  { ok: true; variants: ImageVariant[] } | { ok: false; code: ImageError };

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PIXELS = 25_000_000;
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 10_000;

sharp.concurrency(2);
sharp.cache(false);

const limiter = createLimiter(MAX_CONCURRENT);

async function variant(input: Buffer, size: number): Promise<ImageVariant> {
  const { data, info } = await sharp(input, {
    limitInputPixels: MAX_PIXELS,
    failOn: "error",
    pages: 1,
  })
    .rotate()
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  return { size, body: data, width: info.width, height: info.height };
}

/** Detects, decodes and re-encodes into the given longest-side sizes. */
export async function processImage(
  input: Buffer,
  sizes: readonly number[],
): Promise<ProcessResult> {
  const type = await fileTypeFromBuffer(input);
  if (!type || !ALLOWED.has(type.mime)) {
    return { ok: false, code: "UPLOAD_UNSUPPORTED_TYPE" };
  }
  try {
    const variants = await limiter.run(() =>
      withTimeout(Promise.all(sizes.map((s) => variant(input, s))), TIMEOUT_MS),
    );
    return { ok: true, variants };
  } catch {
    return { ok: false, code: "UPLOAD_DECODE_FAILED" };
  }
}

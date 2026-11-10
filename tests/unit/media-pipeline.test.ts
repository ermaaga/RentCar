import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

import { readCappedBody } from "../../src/app/_lib/upload-body";
import { createLimiter, withTimeout } from "../../src/platform/concurrency/limiter";
import { processImage } from "../../src/platform/image/processor";
import { createLocalStorage } from "../../src/platform/storage/local";

// Upload pipeline pieces (docs/06-backend-api.md 10.3, SR-UPL, ABU-M2-14..17): magic-byte detection,
// re-encoding, local storage key checks and path containment, the body cap and the concurrency cap.

const T = "11111111-2222-4333-8444-555555555555";

function image(format: "jpeg" | "png" | "webp", width = 2000, height = 1000) {
  return sharp({ create: { width, height, channels: 3, background: "#3366cc" } })
    .toFormat(format)
    .toBuffer();
}

describe("processImage", () => {
  it.each(["jpeg", "png", "webp"] as const)("re-encodes %s into WebP variants", async (f) => {
    const result = await processImage(await image(f), [480, 1280]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants.map((v) => [v.size, v.width, v.height])).toEqual([
      [480, 480, 240],
      [1280, 1280, 640],
    ]);
    const meta = await sharp(result.variants[0]?.body).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
  });

  it("never enlarges a small image", async () => {
    const result = await processImage(await image("png", 300, 200), [480]);
    expect(result.ok && result.variants[0]?.width).toBe(300);
  });

  it("refuses types other than JPEG, PNG and WebP whatever they claim", async () => {
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } })
      .gif()
      .toBuffer();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>');
    for (const bytes of [gif, svg, Buffer.from("%PDF-1.7\n"), Buffer.from("hello")]) {
      expect(await processImage(bytes, [480])).toEqual({
        ok: false,
        code: "UPLOAD_UNSUPPORTED_TYPE",
      });
    }
  });

  it("refuses a truncated image as undecodable", async () => {
    const jpeg = await image("jpeg");
    const result = await processImage(jpeg.subarray(0, 200), [480]);
    expect(result).toEqual({ ok: false, code: "UPLOAD_DECODE_FAILED" });
  });
});

describe("local storage", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });
  async function store() {
    const dir = await mkdtemp(join(tmpdir(), "rentcar-storage-"));
    dirs.push(dir);
    return { dir, storage: createLocalStorage(dir) };
  }

  it("puts, gets and deletes an object without leaving temporary files", async () => {
    const { dir, storage } = await store();
    const key = `tenants/${T}/vehicles/${T}/${T}-480.webp`;
    await storage.put(key, Buffer.from("abc"), "image/webp");
    expect(await storage.get(key)).toEqual({ body: Buffer.from("abc"), contentType: "image/webp" });
    expect(await readdir(join(dir, "tenants", T, "vehicles", T))).toEqual([`${T}-480.webp`]);
    await storage.delete(key);
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });

  it("refuses keys outside the allowed shapes", async () => {
    const { storage } = await store();
    for (const key of [
      "../etc/passwd",
      `tenants/${T}/../../x.webp`,
      `tenants/${T}/a/B.webp`,
      `other/${T}/a.webp`,
      `tenants/${T}/a.svg`,
      `/tenants/${T}/a.webp`,
    ]) {
      await expect(storage.get(key)).rejects.toThrow();
      await expect(storage.put(key, Buffer.from("x"), "image/webp")).rejects.toThrow();
    }
  });
});

describe("readCappedBody", () => {
  const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request("http://localhost/x", {
      method: "POST",
      body,
      headers,
      duplex: "half",
    } as RequestInit);

  it("reads a body under the cap", async () => {
    expect(await readCappedBody(post(Buffer.from("12345")), 10)).toEqual({
      ok: true,
      body: Buffer.from("12345"),
    });
  });

  it("refuses a declared length over the cap before reading", async () => {
    const req = post(Buffer.from("1"), { "content-length": "11" });
    expect(await readCappedBody(req, 10)).toEqual({ ok: false, reason: "too_large" });
  });

  it("stops reading a streamed body at the cap", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
      },
    });
    expect(await readCappedBody(post(stream), 10)).toEqual({ ok: false, reason: "too_large" });
  });

  it("treats an empty body as no image", async () => {
    expect(await readCappedBody(post(null), 10)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("limiter", () => {
  it("runs at most `max` tasks at once, in order", async () => {
    const limiter = createLimiter(2);
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const task = (n: number) =>
      limiter.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        order.push(n);
        running -= 1;
      });
    await Promise.all([1, 2, 3, 4, 5].map(task));
    expect(peak).toBe(2);
    expect(order).toHaveLength(5);
  });

  it("releases the slot when a task fails", async () => {
    const limiter = createLimiter(1);
    await expect(limiter.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await limiter.run(() => Promise.resolve(7))).toBe(7);
  });

  it("times out slow work", async () => {
    await expect(withTimeout(new Promise(() => undefined), 10)).rejects.toThrow("timed out");
    expect(await withTimeout(Promise.resolve(1), 10)).toBe(1);
  });
});

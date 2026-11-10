// Browser side of FLT-07: images larger than 2048 px or the byte cap are redrawn on a canvas as JPEG
// before the upload (phones produce 12 MP+ photos); the server re-checks everything regardless.

const MAX_SIDE = 2048;

export type UploadOutcome = "ok" | "type" | "tooLarge" | "decode" | "limit" | "quota" | "failed";

const BY_CODE: Readonly<Record<string, UploadOutcome>> = {
  UPLOAD_UNSUPPORTED_TYPE: "type",
  UPLOAD_TOO_LARGE: "tooLarge",
  UPLOAD_DECODE_FAILED: "decode",
  PHOTO_LIMIT_REACHED: "limit",
  STORAGE_QUOTA_EXCEEDED: "quota",
};

async function downscale(file: File, maxBytes: number): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= maxBytes) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.9);
  });
  return blob ?? file;
}

export async function uploadPhoto(
  url: string,
  file: File,
  maxBytes: number,
): Promise<UploadOutcome> {
  const body = await downscale(file, maxBytes);
  if (body.size > maxBytes) return "tooLarge";
  try {
    const res = await fetch(url, { method: "POST", body, credentials: "same-origin" });
    if (res.ok) return "ok";
    const data = (await res.json().catch(() => ({}))) as { code?: string };
    return BY_CODE[data.code ?? ""] ?? "failed";
  } catch {
    return "failed";
  }
}

import { NextResponse, type NextRequest } from "next/server";

import { getContainer } from "@/composition/container";

// /media/* (docs/06-backend-api.md 10.3 step 8): only public tenant content in the exact shapes the
// server writes; the key is rebuilt from the captured groups, never taken from the path as is.
// Private artefacts are never served here. Objects are immutable (every upload has a new id).

export const dynamic = "force-dynamic";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PHOTO = new RegExp(`^tenants/(${UUID})/vehicles/(${UUID})/(${UUID})-(480|1280)\\.webp$`);

const MEDIA_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function notFound(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ key: string[] }> },
): Promise<NextResponse> {
  const { key } = await props.params;
  const match = PHOTO.exec(key.join("/"));
  if (!match) return notFound();
  const [tenantId, vehicleId, photoId, size] = match.slice(1).map(String);
  const rebuilt = `tenants/${String(tenantId)}/vehicles/${String(vehicleId)}/${String(photoId)}-${String(size)}.webp`;
  const object = await getContainer().storage.get(rebuilt);
  if (!object) return notFound();
  return new NextResponse(new Uint8Array(object.body), {
    headers: { ...MEDIA_HEADERS, "Content-Type": "image/webp" },
  });
}

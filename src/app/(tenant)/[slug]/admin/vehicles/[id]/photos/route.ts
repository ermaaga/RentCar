import { NextResponse, type NextRequest } from "next/server";

import { findTenantAdmin, tenantWriteRefusal } from "@/app/_lib/session";
import { consume, sameOrigin } from "@/app/_lib/security";
import { readCappedBody } from "@/app/_lib/upload-body";
import { getContainer } from "@/composition/container";
import { addVehiclePhoto } from "@/modules/fleet";
import { RATE_LIMITS } from "@/platform/rate-limit/postgres";

// FLT-07 uploadVehiclePhoto (docs/06-backend-api.md 10.3): raw image bytes, admin of a writable
// tenant, same origin, RL-12 per user, size cap before and while reading. The Content-Type and any
// filename are ignored; the image type comes from the bytes. Answers JSON `{ code }` on refusal.

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const STATUS: Readonly<Record<string, number>> = {
  NOT_FOUND: 404,
  UPLOAD_UNSUPPORTED_TYPE: 415,
  UPLOAD_TOO_LARGE: 413,
  UPLOAD_DECODE_FAILED: 422,
  PHOTO_LIMIT_REACHED: 409,
  STORAGE_QUOTA_EXCEEDED: 409,
  UNAUTHENTICATED: 401,
  ORIGIN_REJECTED: 403,
  TENANT_READ_ONLY: 403,
  RATE_LIMITED: 429,
};

function refuse(code: string): NextResponse {
  return NextResponse.json(
    { code },
    { status: STATUS[code] ?? 400, headers: { "Cache-Control": "no-store" } },
  );
}

/** Steps before the body is read; the refusal code, or the tenant and user to upload as. */
async function guard(req: NextRequest, slug: string) {
  if (!sameOrigin(req.headers)) return { code: "ORIGIN_REJECTED" } as const;
  const found = await findTenantAdmin(slug);
  if (!found) return { code: "UNAUTHENTICATED" } as const;
  if (await tenantWriteRefusal(found.tenant)) return { code: "TENANT_READ_ONLY" } as const;
  if (!(await consume(RATE_LIMITS.upload, found.session.userId, "tenant"))) {
    return { code: "RATE_LIMITED" } as const;
  }
  return { code: null, tenantId: found.tenant.tenantId } as const;
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ slug: string; id: string }> },
): Promise<NextResponse> {
  const { slug, id } = await props.params;
  const checked = await guard(req, slug);
  if (checked.code !== null) return refuse(checked.code);
  if (!UUID.test(id)) return refuse("NOT_FOUND");
  const c = getContainer();
  const body = await readCappedBody(req, c.uploadMaxBytes);
  if (!body.ok) {
    return refuse(body.reason === "too_large" ? "UPLOAD_TOO_LARGE" : "UPLOAD_UNSUPPORTED_TYPE");
  }
  const result = await addVehiclePhoto(
    { pool: c.pool, storage: c.storage, quotaBytes: c.storageQuotaBytes },
    { tenantId: checked.tenantId, vehicleId: id },
    body.body,
  );
  if (!result.ok) return refuse(result.code);
  return NextResponse.json(result.photo, { status: 201, headers: { "Cache-Control": "no-store" } });
}

import { NextResponse, type NextRequest } from "next/server";

import { consume, limitReached, requestIp } from "@/app/_lib/security";
import { getContainer } from "@/composition/container";
import { getTranslator } from "@/i18n";
import { renderConfirmationPdf } from "@/modules/booking";
import { loadEffectiveAccess } from "@/modules/subscriptions";
import { resolveTenantBySlug } from "@/modules/tenancy";
import { createLogger } from "@/platform/logging";
import { RATE_LIMITS } from "@/platform/rate-limit/postgres";

// BKG-05 downloadConfirmationPdf (docs/06-backend-api.md 10.1 step 5, SR-PDF-02, ABU-M2-11): tenant
// and code both required; every miss (unknown slug or code, suspended or terminated tenant) is the
// same 404 and counts towards RL-03; past the limit the answer is 429. Never cached, never indexed.

export const dynamic = "force-dynamic";

const logger = createLogger({ service: "rentcar-web" });

const PRIVATE = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
};

function notFound(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { ...PRIVATE, "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function tenantFor(slug: string): Promise<string | null> {
  const c = getContainer();
  const tenant = await resolveTenantBySlug(c.pool, slug);
  if (!tenant) return null;
  const access = await loadEffectiveAccess(c.pool, tenant, c.clock.now());
  return access.state === "suspended" || access.state === "terminated" ? null : tenant.tenantId;
}

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ slug: string; code: string }> },
): Promise<NextResponse> {
  const { slug, code } = await props.params;
  const identity = `${slug}:${await requestIp()}`;
  if (await limitReached(RATE_LIMITS.publicCodeMiss, identity, "public")) {
    return new NextResponse("Too many requests", { status: 429, headers: PRIVATE });
  }
  const tenantId = await tenantFor(slug);
  const result = tenantId
    ? await renderConfirmationPdf(getContainer().pool, { tenantId, code }, getTranslator())
    : ({ ok: false, code: "NOT_FOUND" } as const);
  if (result.ok) {
    return new NextResponse(new Uint8Array(result.pdf), {
      headers: {
        ...PRIVATE,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="booking-${result.code}.pdf"`,
      },
    });
  }
  if (result.code === "PDF_UNAVAILABLE") {
    logger.error({ event: "pdf.failed", tenant_id: tenantId }, "pdf.failed");
    return new NextResponse("PDF unavailable", { status: 503, headers: PRIVATE });
  }
  await consume(RATE_LIMITS.publicCodeMiss, identity, "public");
  return notFound();
}

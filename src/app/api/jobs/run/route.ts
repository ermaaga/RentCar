import { performance } from "node:perf_hooks";

import { NextResponse, type NextRequest } from "next/server";

import { getContainer } from "@/composition/container";
import { getTranslator } from "@/i18n";
import { runDueJobs, runRequest, type RunRequest } from "@/modules/jobs";
import { bearerMatches } from "@/platform/crypto/bearer";
import { clientIp } from "@/platform/host/client-ip";
import { createLogger } from "@/platform/logging";
import { hitRateLimit, isRateLimited, RATE_LIMITS } from "@/platform/rate-limit/postgres";
import { recordSecurityEvent } from "@/platform/security-events/recorder";

// JOB-01 (docs/06-backend-api.md 8.1, ADR-0007): GET for Vercel Cron, POST for the Compose sidecar
// and the GitHub cron. Bearer CRON_SECRET only; every refusal is the same 401. Counts only in the
// response. Failed attempts are limited per IP (RL-13): past the limit even the right secret gets 401.

export const dynamic = "force-dynamic";

const logger = createLogger({ service: "rentcar-web" });
const MAX_BODY = 2048;
const NO_STORE = { "Cache-Control": "no-store" };

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });
}

async function refuse(ip: string, reasonCode: "rate_limited" | "bad_secret", now: Date) {
  const c = getContainer();
  logger.warn({ event: "job.auth_failed", reason: reasonCode }, "jobs call refused");
  await recordSecurityEvent(
    c.pool,
    c.hmacKey,
    { event: "job.auth_failed", realm: "job", outcome: "refused", reasonCode, ip },
    now,
  );
}

async function authorized(req: NextRequest, now: Date): Promise<boolean> {
  const c = getContainer();
  const ip = clientIp(req.headers);
  const limit = { hmacKey: c.hmacKey, rule: RATE_LIMITS.jobAuthFailureIp, identity: ip, now };
  if (await isRateLimited(c.pool, limit)) {
    await refuse(ip, "rate_limited", now);
    return false;
  }
  if (bearerMatches(req.headers.get("authorization"), c.cronSecret)) {
    return true;
  }
  await hitRateLimit(c.pool, limit);
  await refuse(ip, "bad_secret", now);
  return false;
}

async function readBody(req: NextRequest): Promise<RunRequest | undefined> {
  const text = await req.text();
  if (text.length === 0) {
    return {};
  }
  if (text.length > MAX_BODY) {
    return undefined;
  }
  try {
    const parsed = runRequest.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function run(request: RunRequest): Promise<NextResponse> {
  const c = getContainer();
  const started = performance.now();
  try {
    const result = await runDueJobs(c.pool, {
      now: c.clock.now(),
      ...request,
      budgetMs: c.jobsBudgetMs,
      mail: { mailer: c.mailer, fieldKeys: c.fieldKeys, t: getTranslator() },
      elapsedMs: () => performance.now() - started,
      onEvent: (e) => {
        logger.info({ event: e.event, ...e.fields }, e.event);
      },
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    logger.error({ event: "job.run_failed", err }, "jobs run failed");
    return NextResponse.json({ error: "JOB_RUN_FAILED" }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await authorized(req, getContainer().clock.now()))) {
    return unauthorized();
  }
  return run({});
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await authorized(req, getContainer().clock.now()))) {
    return unauthorized();
  }
  const body = await readBody(req);
  if (!body) {
    return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400, headers: NO_STORE });
  }
  return run(body);
}

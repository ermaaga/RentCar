import { z } from "zod";

import { JOB_NAMES } from "../domain/catalogue";

// Body of POST /api/jobs/run (docs/06-backend-api.md JOB-01). GET (Vercel Cron) has no body and runs
// every due job. Unknown fields are rejected so a typo never silently runs everything.
export const runRequest = z
  .object({
    jobs: z.array(z.enum(JOB_NAMES)).min(1).max(JOB_NAMES.length).optional(),
    tenantSlug: z
      .string()
      .regex(/^[a-z0-9-]{3,40}$/)
      .optional(),
  })
  .strict();

export type RunRequest = z.infer<typeof runRequest>;

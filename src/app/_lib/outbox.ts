import { after } from "next/server";

import { getContainer } from "@/composition/container";
import { getTranslator } from "@/i18n";
import { dispatchDue, type OutboxScope } from "@/modules/notifications";

// runAfterResponse (docs/06-backend-api.md 9.2): enqueued notices are sent right after the response,
// so the request never waits on SMTP. Whatever fails here is retried by the hourly outbox job.
export function dispatchAfterResponse(scope: OutboxScope): void {
  after(async () => {
    const c = getContainer();
    await dispatchDue(
      {
        pool: c.pool,
        mailer: c.mailer,
        fieldKeys: c.fieldKeys,
        t: getTranslator(),
        sources: c.emailSources,
      },
      scope,
      c.clock.now(),
      5,
    ).catch(() => undefined);
  });
}

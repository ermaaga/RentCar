import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { getTranslator } from "../../src/i18n";
import { renderCredentialEmail } from "../../src/modules/notifications";
import { createSmtpMailer } from "../../src/platform/mailer/smtp-mailer";

// System mail through Mailpit (AC2: the activation email reaches the mailbox). Needs a running Mailpit.
const smtpHost = process.env.TEST_SMTP_HOST;
const mailpitApi = process.env.TEST_MAILPIT_API;

interface MailpitSearch {
  messages: { Subject: string; To: { Address: string }[] }[];
}

async function inbox(address: string): Promise<MailpitSearch["messages"]> {
  const res = await fetch(
    `${mailpitApi ?? ""}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  return ((await res.json()) as MailpitSearch).messages;
}

describe.skipIf(!smtpHost || !mailpitApi)("system mailer via Mailpit", () => {
  it("delivers the activation email", async () => {
    const to = `admin-${randomUUID().slice(0, 8)}@rentcar.localhost`;
    const mailer = createSmtpMailer({
      host: smtpHost,
      port: 2525,
      security: "none",
      fromAddress: "noreply@rentcar.localhost",
      fromName: "RentCar",
      allowPrivate: true,
    });
    const mail = renderCredentialEmail(
      {
        purpose: "activation",
        to,
        displayName: "Mario",
        username: "mario",
        link: "http://localhost:3000/rent-roma/admin/activate?token=x",
      },
      getTranslator("en"),
    );
    expect(await mailer.sendSystem(mail)).toEqual({ ok: true });
    const messages = await inbox(to);
    expect(messages.map((m) => m.Subject)).toEqual(["Set your RentCar password"]);
  });
});

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { getTranslator } from "../../src/i18n";
import { renderCredentialEmail } from "../../src/modules/notifications";
import { createSmtpMailer } from "../../src/platform/mailer/smtp-mailer";

// System mail through Mailpit (AC2: the activation email reaches the mailbox). Needs a running Mailpit.
const smtpHost = process.env.TEST_SMTP_HOST;
const mailpitApi = process.env.TEST_MAILPIT_API;

interface MailpitSearch {
  messages: { Subject: string; To: { Address: string }[]; Attachments: number }[];
}

async function inbox(address: string): Promise<MailpitSearch["messages"]> {
  const res = await fetch(
    `${mailpitApi ?? ""}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  return ((await res.json()) as MailpitSearch).messages;
}

function mailpitMailer() {
  return createSmtpMailer({
    host: smtpHost,
    port: 1025,
    security: "none",
    fromAddress: "noreply@rentcar.localhost",
    fromName: "RentCar",
    allowPrivate: true,
  });
}

describe.skipIf(!smtpHost || !mailpitApi)("system mailer via Mailpit", () => {
  it("delivers the activation email", async () => {
    const to = `admin-${randomUUID().slice(0, 8)}@rentcar.localhost`;
    const mailer = mailpitMailer();
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

  it("delivers attachments", async () => {
    const to = `pdf-${randomUUID().slice(0, 8)}@rentcar.localhost`;
    const mailer = mailpitMailer();
    const attachment = {
      filename: "booking-AB12CD34EF.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF-1.3 test"),
    };
    const message = { to, subject: "With PDF", text: "t", html: "<p>t</p>" };
    expect(await mailer.sendSystem({ ...message, attachments: [attachment] })).toEqual({
      ok: true,
    });
    expect((await inbox(to)).map((m) => m.Attachments)).toEqual([1]);
  });
});

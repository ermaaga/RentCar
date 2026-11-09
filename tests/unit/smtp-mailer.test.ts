import { describe, expect, it } from "vitest";

import { createSmtpMailer } from "../../src/platform/mailer/smtp-mailer";

const message = { to: "a@b.test", subject: "Hello", text: "t", html: "<p>t</p>" };
const base = {
  port: 587,
  security: "starttls" as const,
  fromAddress: "noreply@rentcar.test",
  fromName: "RentCar",
  allowPrivate: false,
};

// No network in these cases: every refusal happens before a connection is opened.
describe("smtp mailer: refusals before connecting", () => {
  it("reports no_smtp without a host or a from address", async () => {
    expect(await createSmtpMailer(base).sendSystem(message)).toEqual({
      ok: false,
      category: "no_smtp",
    });
    expect(
      await createSmtpMailer({
        ...base,
        host: "smtp.example.com",
        fromAddress: undefined,
      }).sendSystem(message),
    ).toEqual({ ok: false, category: "no_smtp" });
  });

  it("refuses internal hosts and odd ports unless the local override is on", async () => {
    const internal = createSmtpMailer({ ...base, host: "127.0.0.1" });
    expect(await internal.sendSystem(message)).toEqual({ ok: false, category: "blocked_address" });
    const port = createSmtpMailer({ ...base, host: "smtp.example.com", port: 8025 });
    expect(await port.sendSystem(message)).toEqual({ ok: false, category: "blocked_port" });
  });

  it("refuses CR or LF in headers", async () => {
    const mailer = createSmtpMailer({ ...base, host: "smtp.example.com" });
    expect(await mailer.sendSystem({ ...message, subject: "Hi\r\nBcc: x@y.test" })).toEqual({
      ok: false,
      category: "rejected",
    });
  });
});

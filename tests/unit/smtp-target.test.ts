import { describe, expect, it, vi } from "vitest";

import { createSmtpMailer } from "../../src/platform/mailer/smtp-mailer";
import { guardedSmtpTarget, type HostResolver } from "../../src/platform/mailer/smtp-target";

// ABU-M1-19/20 with a fake network layer: the resolver is the only way out, so "no socket opened"
// means the resolver answer was refused before any connection attempt.
const fixed =
  (...addresses: string[]): HostResolver =>
  () =>
    Promise.resolve(addresses);

describe("guardedSmtpTarget (SR-SSRF-01..04)", () => {
  it("returns the validated IP and keeps the hostname for TLS", async () => {
    expect(await guardedSmtpTarget("smtp.example.com", 587, fixed("8.8.8.8"))).toEqual({
      ok: true,
      ip: "8.8.8.8",
      servername: "smtp.example.com",
    });
  });

  it.each([
    ["127.0.0.1"],
    ["8.8.8.8"],
    ["[::1]"],
    ["::ffff:127.0.0.1"],
    ["localhost"],
    ["mail.internal"],
    ["2130706433"],
    ["0x7f.1"],
    ["smtp.example.com."],
    [""],
  ])("refuses the host %s as invalid_host without resolving it", async (host) => {
    const resolve = vi.fn(fixed("8.8.8.8"));
    expect(await guardedSmtpTarget(host, 587, resolve)).toEqual({
      ok: false,
      category: "invalid_host",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([["10.0.0.5"], ["169.254.169.254"], ["100.64.0.1"], ["fc00::1"], ["::ffff:192.168.1.1"]])(
    "refuses a public name whose record is %s",
    async (ip) => {
      expect(await guardedSmtpTarget("smtp.example.com", 587, fixed("8.8.8.8", ip))).toEqual({
        ok: false,
        category: "blocked_address",
      });
    },
  );
});

describe("guardedSmtpTarget ports, DNS failures and IDN", () => {
  it("refuses a port outside the allowlist before resolving", async () => {
    const resolve = vi.fn(fixed("8.8.8.8"));
    expect(await guardedSmtpTarget("smtp.example.com", 22, resolve)).toEqual({
      ok: false,
      category: "blocked_port",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("maps no records and resolver errors to dns_failed", async () => {
    expect((await guardedSmtpTarget("smtp.example.com", 587, fixed())).ok).toBe(false);
    const failing: HostResolver = () => Promise.reject(new Error("SERVFAIL"));
    expect(await guardedSmtpTarget("smtp.example.com", 587, failing)).toEqual({
      ok: false,
      category: "dns_failed",
    });
  });

  it("converts an IDN to ASCII before checking", async () => {
    const resolve = vi.fn(fixed("8.8.8.8"));
    const target = await guardedSmtpTarget("pòsta.example.com", 587, resolve);
    expect(target).toMatchObject({ ok: true, servername: "xn--psta-lqa.example.com" });
  });
});

describe("Mailer.sendTenant guard (ABU-M1-20 DNS rebinding)", () => {
  const tenant = {
    host: "smtp.example.com",
    port: 587,
    security: "starttls" as const,
    username: "u",
    password: "p",
    fromAddress: "noreply@example.com",
  };
  const message = { to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" };
  const system = {
    port: 587,
    security: "starttls" as const,
    fromName: "RentCar",
    allowPrivate: false,
  };

  it("resolves again on every send and refuses when the record turned private", async () => {
    const answers = [["8.8.8.8"], ["127.0.0.1"]];
    const resolve = vi.fn<HostResolver>(() => Promise.resolve(answers.shift() ?? []));
    await guardedSmtpTarget(tenant.host, tenant.port, resolve);
    const mailer = createSmtpMailer(system, { resolve });
    expect(await mailer.sendTenant(tenant, message)).toEqual({
      ok: false,
      category: "blocked_address",
    });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("refuses header injection in tenant-controlled sender fields", async () => {
    const mailer = createSmtpMailer(system, { resolve: fixed("8.8.8.8") });
    const result = await mailer.sendTenant({ ...tenant, fromName: "x\r\nBcc: y@z" }, message);
    expect(result).toEqual({ ok: false, category: "rejected" });
  });
});

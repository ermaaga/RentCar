import { describe, expect, it } from "vitest";

import { checkSmtpEndpoint, isNonPublicIp } from "../../src/platform/mailer/host-guard";

describe("SMTP host guard (EM-01, ABU-M1-19)", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])("refuses the non-public address %s", (ip) => {
    expect(checkSmtpEndpoint(ip, 587)).toEqual({ ok: false, reason: "non_public_address" });
  });

  it.each(["localhost", "mail.localhost", "server.internal", "2130706433", "0x7f.1", "smtp"])(
    "refuses the reserved or non-hostname form %s",
    (host) => {
      expect(checkSmtpEndpoint(host, 587).ok).toBe(false);
    },
  );

  it("accepts a public hostname on an allowed port", () => {
    expect(checkSmtpEndpoint("smtp.example.com", 587)).toEqual({ ok: true });
    expect(checkSmtpEndpoint("8.8.8.8", 465)).toEqual({ ok: true });
  });

  it("refuses a port outside 25, 465, 587 and 2525", () => {
    for (const port of [22, 80, 110, 143, 3306, 5432, 6379, 8080]) {
      expect(checkSmtpEndpoint("smtp.example.com", port)).toEqual({
        ok: false,
        reason: "port_not_allowed",
      });
    }
  });
});

describe("SMTP address classification (SR-SSRF-02)", () => {
  it.each([
    "203.0.113.9",
    "198.51.100.1",
    "192.0.2.1",
    "198.18.0.1",
    "240.0.0.1",
    "2001:db8::1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::1",
    "2001::1",
    "100::1",
    "fec0::1",
    "ff02::1",
  ])("refuses the reserved, documentation or embedded-private address %s (SR-SSRF-02)", (ip) => {
    expect(isNonPublicIp(ip)).toBe(true);
  });

  it("classifies IP literals", () => {
    expect(isNonPublicIp("8.8.8.8")).toBe(false);
    expect(isNonPublicIp("64:ff9b::808:808")).toBe(false);
    expect(isNonPublicIp("2606:4700::1111")).toBe(false);
    expect(isNonPublicIp("not-an-ip")).toBe(false);
  });
});

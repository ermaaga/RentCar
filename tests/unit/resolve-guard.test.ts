import { describe, expect, it } from "vitest";

import { guardedSmtpAddress } from "../../src/platform/mailer/resolve-guard";

// Connection-time SSRF guard (ABU-M1-20): every resolved address must be public.
const answer = (addresses: string[]) => () => Promise.resolve(addresses);

describe("guardedSmtpAddress", () => {
  it("returns the first public address of a public host", async () => {
    expect(await guardedSmtpAddress("smtp.example.com", 587, answer(["93.184.216.34"]))).toEqual({
      ok: true,
      address: "93.184.216.34",
    });
  });

  it("refuses a host when any resolved address is internal", async () => {
    const mixed = answer(["93.184.216.34", "10.0.0.5"]);
    expect(await guardedSmtpAddress("smtp.example.com", 587, mixed)).toEqual({
      ok: false,
      category: "blocked_address",
    });
  });

  it("reports dns_failed on errors and empty answers", async () => {
    const failing = () => Promise.reject(new Error("ENOTFOUND"));
    expect(await guardedSmtpAddress("smtp.example.com", 587, failing)).toEqual({
      ok: false,
      category: "dns_failed",
    });
    expect(await guardedSmtpAddress("smtp.example.com", 587, answer([]))).toEqual({
      ok: false,
      category: "dns_failed",
    });
  });
});

describe("guardedSmtpAddress: literal checks", () => {
  it("applies the literal checks before resolving", async () => {
    const never = () => Promise.reject(new Error("must not resolve"));
    expect(await guardedSmtpAddress("smtp.example.com", 8025, never)).toEqual({
      ok: false,
      category: "blocked_port",
    });
    expect(await guardedSmtpAddress("localhost", 587, never)).toEqual({
      ok: false,
      category: "invalid_host",
    });
    expect(await guardedSmtpAddress("192.168.1.10", 587, never)).toEqual({
      ok: false,
      category: "blocked_address",
    });
    expect(await guardedSmtpAddress("93.184.216.34", 587, never)).toEqual({
      ok: true,
      address: "93.184.216.34",
    });
  });
});

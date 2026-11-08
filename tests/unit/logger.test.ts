import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { createLogger } from "../../src/platform/logging";

function capture(): { log: ReturnType<typeof createLogger>; lines: () => string } {
  const stream = new PassThrough();
  let out = "";
  stream.on("data", (chunk: Buffer) => {
    out += chunk.toString();
  });
  return { log: createLogger({ destination: stream, service: "test" }), lines: () => out };
}

describe("logger redaction (SR-LOG-01)", () => {
  it("never writes secrets, tokens or contact details, and keeps the event", () => {
    const { log, lines } = capture();
    log.info(
      {
        event: "auth.login",
        password: "CANARY_PASS_7f3a",
        token: "CANARY_TOKEN_9b1c",
        user: { email: "CANARY_NAME_7f3a@example.test", phone: "+390000000" },
        headers: { authorization: "Bearer CANARY_TOKEN_9b1c" },
      },
      "login attempt",
    );
    const out = lines();
    expect(out).toContain("auth.login");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("CANARY_PASS_7f3a");
    expect(out).not.toContain("CANARY_TOKEN_9b1c");
    expect(out).not.toContain("CANARY_NAME_7f3a");
    expect(out).not.toContain("+390000000");
  });

  it("writes JSON lines with the service name and an ISO timestamp", () => {
    const { log, lines } = capture();
    log.warn({ event: "readiness.failed" }, "readiness check failed");
    const entry = JSON.parse(lines().trim()) as Record<string, unknown>;
    expect(entry.service).toBe("test");
    expect(entry.level).toBe(40);
    expect(typeof entry.time).toBe("string");
    expect(entry.message).toBe("readiness check failed");
  });
});

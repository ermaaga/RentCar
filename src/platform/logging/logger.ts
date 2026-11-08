import pino, { type Logger } from "pino";

// Fields that must never reach a log line (03b section 9, SR-LOG-01). Values are replaced, keys kept.
export const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "authorization",
  "headers.authorization",
  "headers.cookie",
  "cookie",
  "email",
  "*.email",
  "phone",
  "*.phone",
  "*.connectionString",
  "databaseUrl",
  "DATABASE_URL",
];

export interface LoggerOptions {
  level?: string;
  service?: string;
  destination?: NodeJS.WritableStream;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino(
    {
      level: options.level ?? "info",
      base: { service: options.service ?? "rentcar" },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      messageKey: "message",
    },
    (options.destination as pino.DestinationStream | undefined) ?? pino.destination(1),
  );
}

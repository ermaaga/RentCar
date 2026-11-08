/** Port for error tracking. Production adapters (e.g. Sentry) are chosen at deployment (ADR-0011). */
export interface ErrorReporter {
  capture(error: unknown, context?: Readonly<Record<string, string>>): void;
}

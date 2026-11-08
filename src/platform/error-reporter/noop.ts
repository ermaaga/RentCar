import type { ErrorReporter } from "./port";

/** Default adapter: reports nothing. Used until an error tracker is configured (OBS-series decisions). */
export const noopErrorReporter: ErrorReporter = {
  capture: () => undefined,
};

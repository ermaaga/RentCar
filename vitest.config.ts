import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Same alias as tsconfig.json, so route handlers can be tested directly.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/security/**/*.test.ts",
      "src/**/*.test.ts",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      // Pure layers measured by the unit job (no database): the Definition of Done gates of
      // docs/13-piano-implementazione.md section 4 (domain >= 90 %, application >= 80 %).
      // Infrastructure is covered by the integration suite against Postgres.
      include: [
        "src/platform/config/**",
        "src/shared/**",
        "src/modules/*/domain/**",
        "src/modules/*/application/**",
      ],
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        "src/modules/*/domain/**": { lines: 90, branches: 85, functions: 90, statements: 90 },
        "src/modules/*/application/**": { lines: 80, branches: 80, functions: 80, statements: 80 },
      },
    },
  },
});

/** Architecture rules of docs/03b-struttura-codice.md sections 3 and 10. Blocking in CI. */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "No import cycles (03b section 3, rule 3).",
      from: {},
      to: { circular: true },
    },
    {
      name: "app-no-infrastructure",
      severity: "error",
      comment: "app/ wires services and UI only; never infrastructure or the DB.",
      from: { path: "(^|/)src/app/" },
      to: { path: "(^|/)src/modules/[^/]+/infrastructure/" },
    },
    {
      name: "modules-no-app",
      severity: "error",
      comment: "Business modules must not depend on the presentation layer.",
      from: { path: "(^|/)src/modules/" },
      to: { path: "(^|/)src/app/" },
    },
    {
      name: "domain-only-shared-and-self",
      severity: "error",
      comment: "domain/ is pure: only shared/ and its own domain/ (03b section 3).",
      from: { path: "(^|/)src/modules/([^/]+)/domain/" },
      to: {
        path: "(^|/)src/",
        pathNot: ["(^|/)src/shared/", "(^|/)src/modules/([^/]+)/domain/"],
      },
    },
    {
      name: "no-deep-module-import",
      severity: "error",
      comment: "Other modules are reached only through modules/<name>/index.ts.",
      from: { path: "(^|/)src/modules/([^/]+)/" },
      to: {
        path: "(^|/)src/modules/([^/]+)/",
        pathNot: ["(^|/)src/modules/$2/", "(^|/)src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "orm-and-sdk-only-in-adapters",
      severity: "error",
      comment: "ORM and provider SDKs only in infrastructure/ and platform/ adapters (03b rule 1).",
      from: {
        pathNot: [
          "(^|/)src/modules/[^/]+/infrastructure/",
          "(^|/)src/platform/",
          "(^|/)src/composition/",
          "(^|/)scripts/",
          "(^|/)tests/",
        ],
      },
      to: {
        dependencyTypesNot: ["type-only"],
        path: "node_modules/(drizzle-orm|pg|@aws-sdk/[^/]+|nodemailer|sharp|@react-pdf/renderer|@sentry/[^/]+)/",
      },
    },
    {
      name: "ui-no-infrastructure",
      severity: "error",
      comment: "Feature UI never reaches infrastructure or the DB (03b section 3).",
      from: { path: "(^|/)src/modules/[^/]+/ui/" },
      to: { path: "(^|/)src/modules/[^/]+/infrastructure/|(^|/)src/platform/db/" },
    },
    {
      name: "no-deep-import-into-platform-adapters",
      severity: "error",
      comment:
        "platform/* adapters never import business modules (except tenancy types, 03b section 3).",
      from: { path: "(^|/)src/platform/" },
      to: {
        path: "(^|/)src/modules/",
        pathNot: ["(^|/)src/modules/tenancy/index\\.ts$"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs"] },
    exclude: { path: "(^|/)(\\.next|node_modules|coverage)/" },
    includeOnly: { path: "^(src|scripts|tests)/" },
  },
};

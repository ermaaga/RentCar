import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ENTRY_POINTS } from "../../src/app/_lib/entry-points";

// ABU-M0-13 / SR-ACC-01: every entry point is registered with its realm, role and write class, and
// every public or scheduler one says why it needs no session.
const APP = resolve(__dirname, "../../src/app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const EXPORTED = /^export (?:async function (\w+)|const (\w+) = (?:tenantAction|systemAction)\()/gm;

function actionIds(file: string, rel: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(EXPORTED)].map(
    (m) => `action:${rel.replace(/\.ts$/, "")}#${m[1] ?? m[2] ?? ""}`,
  );
}

function entryIds(file: string): string[] {
  const rel = relative(APP, file).split("\\").join("/");
  if (rel.startsWith("actions/") && rel.endsWith(".ts")) {
    return actionIds(file, rel);
  }
  if (rel.endsWith("/route.ts")) {
    return [`route:${rel.replace(/\/route\.ts$/, "")}`];
  }
  if (rel === "page.tsx" || rel.endsWith("/page.tsx")) {
    return [`page:${rel === "page.tsx" ? "page" : rel.replace(/\/page\.tsx$/, "")}`];
  }
  return [];
}

function discovered(): string[] {
  return walk(APP).flatMap(entryIds).sort();
}

describe("route registry", () => {
  it("lists exactly the entry points that exist", () => {
    const registered = ENTRY_POINTS.map((e) => e.id).sort();
    expect(registered).toEqual(discovered());
  });

  it("gives every public or scheduler entry point a reason, and every other a role", () => {
    for (const e of ENTRY_POINTS) {
      if (e.realm === "public" || e.realm === "scheduler") {
        expect(e.reason, e.id).toBeTruthy();
      } else {
        expect(e.minRole, e.id).toBeTruthy();
      }
    }
  });
});

describe("route registry: guards", () => {
  // defineAction (06-backend-api 3.2): protected actions are built with the wrapper of their realm,
  // with the role the registry declares; their behaviour is in tests/integration/access-matrix.
  it("builds every protected action with tenantAction or systemAction", () => {
    const actions = ENTRY_POINTS.filter(
      (x) => x.id.startsWith("action:") && (x.realm === "tenant" || x.realm === "system"),
    );
    for (const e of actions) {
      const [file = "", name = ""] = e.id.slice("action:".length).split("#");
      const source = readFileSync(join(APP, `${file}.ts`), "utf8");
      const start = source.indexOf(`export const ${name} = `);
      expect(start, `${e.id} is not built with a wrapper`).toBeGreaterThanOrEqual(0);
      const head = source.slice(start, start + 400);
      if (e.realm === "system") {
        expect(head, e.id).toContain("systemAction(");
      } else {
        expect(head, e.id).toContain("tenantAction(");
        // Either inline options or a shared constant of the same file (its minRole is read from it).
        const shared = /tenantAction\(\s*([A-Z_]+),/.exec(head)?.[1];
        const at = shared ? source.indexOf(`const ${shared} = `) : -1;
        const options = shared ? source.slice(at, at + 200) : head;
        expect(/minRole: "(\w+)"/.exec(options)?.[1], e.id).toBe(e.minRole);
      }
    }
  });
});

describe("route registry: pages", () => {
  // Pages are checked statically here.
  it("guards every protected page in code", () => {
    const pages = ENTRY_POINTS.filter(
      (x) => x.id.startsWith("page:") && (x.realm === "tenant" || x.realm === "system"),
    );
    for (const e of pages) {
      const file = join(APP, e.id.slice("page:".length), "page.tsx");
      const source = readFileSync(file, "utf8");
      const guard =
        e.realm === "system"
          ? /requireSystemSession|\(console\)/
          : e.minRole === "admin"
            ? /requireTenantAdmin/
            : /requireTenantSession|requireTenantAdmin|resolveTenantBySlug/;
      expect(guard.test(source) || guard.test(file), e.id).toBe(true);
    }
  });
});

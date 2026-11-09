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

function discovered(): string[] {
  const ids: string[] = [];
  for (const file of walk(APP)) {
    const rel = relative(APP, file).split("\\").join("/");
    if (rel.startsWith("actions/") && rel.endsWith(".ts")) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/^export async function (\w+)/gm)) {
        ids.push(`action:${rel.replace(/\.ts$/, "")}#${m[1] ?? ""}`);
      }
    } else if (rel.endsWith("/route.ts")) {
      ids.push(`route:${rel.replace(/\/route\.ts$/, "")}`);
    } else if (rel === "page.tsx" || rel.endsWith("/page.tsx")) {
      ids.push(`page:${rel === "page.tsx" ? "page" : rel.replace(/\/page\.tsx$/, "")}`);
    }
  }
  return ids.sort();
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

  // Actions are checked by behaviour in tests/integration/access-matrix.test.ts.
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

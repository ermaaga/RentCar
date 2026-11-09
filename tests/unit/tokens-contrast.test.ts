import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// WCAG 2.2 AA contrast of the design tokens, in both themes (docs/04b-ui-design.md, UI-2).
// Text pairs need 4.5:1; focus and border against background need 3:1 (non-text, WCAG 1.4.11).
const css = readFileSync(resolve(__dirname, "../../src/styles/tokens.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) {
    throw new Error(`selector not found: ${selector}`);
  }
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    vars[m[1] ?? ""] = (m[2] ?? "").trim();
  }
  return vars;
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const themes = {
  light: block(":root {"),
  dark: block(':root[data-theme="dark"]'),
};

describe.each(Object.entries(themes))("token contrast (%s theme)", (_name, t) => {
  const color = (name: string): string => t[name] ?? "";
  const bg = color("background");

  it("body text on background is at least 4.5:1", () => {
    expect(ratio(color("foreground"), bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("muted text on background is at least 4.5:1", () => {
    expect(ratio(color("muted-foreground"), bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("error text on background is at least 4.5:1", () => {
    expect(ratio(color("danger"), bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("primary button text on primary is at least 4.5:1", () => {
    expect(ratio(color("primary-foreground"), color("primary"))).toBeGreaterThanOrEqual(4.5);
  });
  it("focus indicator on background is at least 3:1", () => {
    expect(ratio(color("focus"), bg)).toBeGreaterThanOrEqual(3);
  });
  it("borders on background are at least 3:1", () => {
    expect(ratio(color("border"), bg)).toBeGreaterThanOrEqual(3);
  });
});

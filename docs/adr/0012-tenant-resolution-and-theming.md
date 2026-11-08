# ADR-0012: Single tenant-resolution point and runtime theming

- Status: accepted
- Date: 2026-11-01 (accepted at GATE 2, 2026-11-01)
- Deciders: user (GATE 2), solution-architect, ui-designer

## Context
Path-based `/{slug}` today; custom domains per tenant later (FR-PLT-04). Per-tenant colours, title, logo and font at runtime on the public site and admin (AC9, AC11), WCAG AA checks, light/dark, no third-party CDN fonts, strict CSP, validated hex only.

## Options considered
Resolution: (1) `TenantResolver` port called from one place; (2) tenant derived ad hoc in pages.
Theming: (a) inline `<style nonce>` per page; (b) same-origin stylesheet per tenant; (c) build-time themes (impossible, runtime values); (d) `style` attributes.

## Decision
- `TenantResolver.resolve({ host, pathname }) -> { tenant, basePath } | notFound` is the only code that parses `/{slug}`; today it reads the path, later it maps host to tenant and the proxy rewrites to the same internal route. All links come from `tenantUrl(tenant, path)`; reserved slugs (`system`, `api`, `media`, `_next`, static names) are rejected at creation. Result memoised per request via `React.cache`; suspension takes effect immediately (no cross-request cache).
- `deriveTheme(palette)` is a pure function (hover, disabled, on-colour, dark variants, contrast ratios, block when a pair < 3:1, FR-BRD-04). A route handler `/{slug}/theme.css?v={themeVersion}` emits CSS variables (`:root`, dark media query and `[data-theme]` override) with immutable caching; no inline style needed for the tenant palette.
- Fonts: Inter, Manrope, Plus Jakarta Sans (SIL OFL) as self-hosted woff2 variable files with `@font-face`/`font-display: swap`; only the selected family is requested.
- Shadcn/Radix inline `style` attributes may need `style-src-attr 'unsafe-inline'`; decision with security-engineer in Phase 4.

## Consequences
- Custom domains become a resolver plus proxy change; no business code change (US-122 test).
- Theme CSS is CDN/browser cacheable and CSP-friendly.
- Palette change bumps `themeVersion`, invalidating caches.

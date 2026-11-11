# M2 SEO checks: public pages

Version 1.0 · 2026-11-11 · Checked by: PM (Claude) against `docs/09-seo.md` v1.1 · Scope: the SEO slice of M2 (public `/{slug}` flow, robots, headers)

This covers the "SEO checks" item of the M2 Definition of Done (`13-piano-implementazione.md` §3). It is not the go-live audit (`09-seo.md` §15 needs a staging host, Lighthouse CI and the Rich Results Test).

## 1. What was built

| Rule | Implementation |
|---|---|
| SR-06 environment switch | `PUBLIC_INDEXING_ENABLED` (typed config, default `false`, only the exact value `true` enables it; `.env.example`, Compose) |
| SR-05 / SR-HDR-04 header class | `src/proxy.ts` + `src/app/_lib/robots-policy.ts`: `X-Robots-Tag: noindex, nofollow` on every response when indexing is off; when on, `noindex, nofollow` on `/`, `/system`, `/api`, `/{slug}/admin`, booking form, confirmation and any unknown path, `noindex, follow` on the results and on the root with a query string, no header on the plain root (the page decides). `/media`, `/_next`, `robots.txt` are not touched |
| SR-07 robots.txt | `src/app/robots.ts`, read at request time: `Disallow: /` when off; `Allow: /`, `Disallow: /api/` when on; no Sitemap line (SR-08) |
| SR-03 canonical | `canonicalUrl()` in `tenancy/domain/public-seo.ts`, origin from `APP_BASE_URL` only; every public page points to `{origin}/{slug}` |
| SR-04 normalisation | Trailing slash: Next.js 308 to the bare path. Uppercase slug: 301 to the lowercase path, `Location` built from `APP_BASE_URL` (never the Host header) |
| SR-11 title and description | Root: `{tenant title} \| Car rental`; tenant description or the 09-seo template, capped at 160 characters; other pages `{page} · {tenant title}` |
| SR-12 Open Graph | `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `twitter:card` |
| SR-13 JSON-LD | `AutoRental` on the root of a tenant that takes bookings: name, url, telephone (only when it reads as E.164), email, currency, payment, postal address when stored. `<`, U+2028 and U+2029 escaped; rendered as script text (no `dangerouslySetInnerHTML`) |
| Root robots meta | `index, follow` only with the switch on, no query string and a tenant that takes bookings; `noindex, follow` with a query; `noindex, nofollow` when the tenant is suspended, terminated or past grace (FE-1: HTTP 200) |
| SR-16 | `Referrer-Policy: no-referrer` on `/{slug}/booking/{code}` and its PDF |

## 2. Verification

- Unit: `tests/unit/public-seo.test.ts` (canonical, header policy per page class, uppercase redirect, description cap, E.164, JSON-LD fields and escaping), `tests/unit/config.test.ts` (switch default and strict parsing).
- E2E: `tests/e2e/seo.spec.ts` (switch off, as in every non-production stack): header on public, admin, system and API paths, robots.txt, root title, canonical, `og:url`, JSON-LD, uppercase 301, unknown slug 404, no-referrer on the confirmation.
- Manual run on a production build with `PUBLIC_INDEXING_ENABLED=true` (curl, 2026-11-11): plain root 200 with `index, follow` and no header; root with query `noindex, follow`; results and booking form with the expected header; unknown slug 404 with `<meta name="robots" content="noindex">`; suspended tenant 200 with `noindex, nofollow`; tenant title containing `</script>` stays escaped in the title, meta tags and JSON-LD.

## 3. Deviations and open items

| # | Item | Status |
|---|---|---|
| S1 | `og:image` (1200×630 JPEG from the logo) and `twitter:card=summary_large_image` | Deferred to M5 with the branding and logo upload; `twitter:card=summary` until then |
| S2 | `X-Robots-Tag` on the unknown-slug 404 and on the suspended or closed root: meta tag only. The proxy has no tenant state and FE-1 rules out a per-request status query | Accepted (low): the meta tag is honoured by search engines; the 404 status alone keeps the page out |
| S3 | An uppercase variant of an unknown slug answers 301 and then 404 (09-seo §3 wants a direct 404); the proxy does not query the database | Accepted (low) |
| S4 | Lighthouse CI on `/{slug}` (NFR-PERF-01, SR-14) | **Done locally** (`docs/test-reports/m2-performance.md`); nightly workflow `nightly-perf.yml`; staging run still open |
| S5 | Rich Results Test and schema.org validator on the JSON-LD | Open: go-live audit (needs a public URL) |
| S6 | SR-10 host policy and custom domains | Not built (design only, FR-PLT-04) |

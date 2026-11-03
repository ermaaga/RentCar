# SEO requirements: RentCar

Version 1.1 · 2026-11-03 · Owner: seo-specialist · Status: proposal for PM review (Phase 4, wave A)

## Change log
- **v1.1 (2026-11-03, decision FE-1)**: suspended and terminated tenants return **HTTP 200** with `noindex, nofollow` and the neutral page (no 503). 410 is not used anywhere. Hard-deleted tenants (slug tombstone) return 404. SEO-5 (503 versus 200 for suspended) is superseded and removed from the open questions. Updated: status table (section 5), SR-09 and section 10, go-live checks (section 15), Esito and questions.
- **v1.0 (2026-11-01)**: first version.
Inputs: `docs/02-requisiti.md` v1.2 (FR-PUB-01/13/14, FR-PLT-04/07, FR-BRD-01/08/09, NFR-PERF-01, NFR-GDPR-07, NFR-SEC-04), `docs/01-discovery.md` (C12, E20, E21, F23), `docs/03-architettura.md` and ADR-0010, 0012, 0014, `docs/spec/car-rental-spec.md` §6, `docs/03-inputs/security-constraints.md` §9.
Language: English (documentation decision). Questions for the user are in Italian in the last section.

Requirement IDs in this document are `SR-nn` (SEO requirement). `SEO-n` is reserved for user questions.

---

## 0. Verdict

- **Only one page type per tenant is worth indexing**: the booking entry page `/{slug}` (search form, tenant identity, contact details). Everything else in the public flow is `noindex`.
- The platform has **no marketing site** and **no catalogue of vehicle pages**. There is nothing else to optimise.
- SEO is not a stated goal (discovery E20). The minimal baseline below costs little, because the root page is already server-rendered for performance and the noindex rules are needed for privacy anyway (booking codes, customer data, admin pages).
- Not worth doing now: sitemap, per-tenant structured data beyond `AutoRental`, FAQ, reviews, breadcrumbs, hreflang, pagination, per-tenant analytics. See section 9.

## 1. Intent and keyword targets

| Template | Search intent | Target (examples) | Index? |
|---|---|---|---|
| `/{slug}` (root) | Navigational and local transactional | "{tenant title} car rental", "rent a car {tenant title}", "car rental {city}" only if a city is stored (SEO-4) | Yes (SR-01) |
| Results (`/{slug}?…`) | None (dynamic, date-dependent) | none | No |
| Booking form, confirmation, unavailable, 404 | None | none | No |
| Admin, system, API | None | none | No (SR-05) |

Context, preliminary (WebSearch, 2026-11-01): generic queries such as "car rental Italy" are dominated by aggregators (e.g. Kayak). A single tenant page will not compete for those queries. Expected organic traffic is brand/name queries and direct links. No search volumes are assumed here; measure after go-live in Search Console (section 14).

## 2. Rendering

- **SR-02** The root `/{slug}` is server-rendered on each request. Its initial HTML (without running JavaScript) contains: `<title>`, meta description, canonical, the H1, the tenant contact block and the search form. Tenant identity must not depend on client-side rendering.
- **Dynamic, not static**: no ISR and no Next data cache for tenant pages. Suspension, expiry and renewal must apply on the next request (ADR-0014). This is already the architecture; SEO does not need static output.
- Results and booking pages are also server-rendered (performance, NFR-PERF-01), but they are `noindex`.
- `<html lang="en">` on all public pages (UI language is English, decision F23).
- Frontend decides the mechanics (route structure, Server Components, metadata API). The rules here are the observable output.

## 3. URLs

- Canonical form: `{origin}/{slug}`, lowercase, no trailing slash, no query string. Slugs are lowercase by rule (A-5).
- **SR-04** Normalisation:
  - `/{slug}/` → 308 to `/{slug}`.
  - Uppercase variant of an existing slug → 301 to the lowercase slug; unknown slug → 404.
  - Query parameters never change the canonical URL.
- Search state (dates, sort, filters) lives in the query string and the search uses GET, so Back and reload work. This is a UX recommendation to frontend; SEO is neutral because results are `noindex`.
- Pagination: not needed. A tenant has at most ~50 vehicles (NFR-SCL-01) and they fit on one results page. Faceted URLs are blocked by noindex plus canonical (section 4), not by robots.txt.

## 4. Canonical rules and future custom domains

- **SR-03** Every public HTML page has one `<link rel="canonical">` with an absolute URL, built only by `canonicalUrl(tenant, path)` in the `tenancy` module (it extends `tenantUrl()`, ADR-0012). The origin comes from configuration. **The request `Host` header is never used** for canonical, Open Graph or JSON-LD URLs (host-header poisoning, security-constraints §5 and §12).
- Phase 1: origin = `APP_BASE_URL`. The canonical of tenant `sunny-rent` is `{APP_BASE_URL}/sunny-rent`.
- Result variants, booking flow and error states point their canonical to the root `{origin}/{slug}` (table in section 5).

Custom domains (design only, FR-PLT-04, not built):

- **SR-10 Host policy**: a host is served only if it is the platform origin or a verified custom domain of a tenant. Platform hostnames that are not canonical (e.g. Vercel default hostnames) → 301 to the canonical origin. Any other host → 404 with noindex.
- When a tenant has a verified custom domain, that origin becomes its canonical origin (`tenant.canonicalOrigin`):
  - `{APP_BASE_URL}/{slug}` and sub-paths → 301 to the same path on the custom domain (the custom domain root is `/`).
  - On the custom domain, `/{slug}` is not served (404 or 301 to `/`, to decide with the resolver).
  - Redirects are permanent and kept indefinitely.
- One tenant = one canonical origin at any time. Apex versus `www`: decided when the first custom domain is added; the other form 301s to the chosen one.
- Session cookies stay host-only (no `Domain` attribute), per security-constraints §3 item 5. Not an SEO rule, listed for the custom-domain change.
- Hreflang: not applicable (English only). When a second locale is added, `hreflang` with `x-default` per locale is required and the canonical rule changes per locale.

## 5. Indexing directives and status codes per page type

Applies to the meta robots tag **and** to the `X-Robots-Tag` header (the header works on every status code, including 404).

| Public URL / tenant state | HTTP status | Robots | Canonical |
|---|---|---|---|
| `/{slug}`, tenant active or in grace (≤ 7 days after endDate) | 200 | `index, follow` | self |
| `/{slug}?…` (any query: dates, filters, sort) | 200 | `noindex, follow` | `{origin}/{slug}` |
| Booking form and any other public HTML sub-path (route names decided by frontend, assumption A-1) | 200 | `noindex, nofollow` | `{origin}/{slug}` |
| Confirmation `…/{bookingCode}` | 200 | `noindex, nofollow` + `Cache-Control: no-store` | `{origin}/{slug}` |
| Past grace or subscription cancelled (root and all public paths; FR-SYS-13) | 200 | `noindex, nofollow` | `{origin}/{slug}` |
| Suspended or terminated, before deletion (FR-SYS-12, FR-SYS-16); neutral "temporarily unavailable" page, no search form (FE-1) | 200 | `noindex, nofollow` | `{origin}/{slug}` |
| Hard-deleted tenant, slug tombstone (US-066); 410 not used (FE-1) | 404 | `noindex, nofollow` | none |
| Unknown slug, unknown path, reserved word | 404 | `noindex, nofollow` | none |
| `/system/*`, `/{slug}/admin/*`, `/api/*` | as the app returns | `X-Robots-Tag: noindex, nofollow` on every response | none |

Non-HTML assets (`/{slug}/theme.css`, `/media/*`) carry no directive. They are public, not listable, and not worth more rules.

- **SR-05** The table above is implemented exactly. Admin login pages, password reset pages and `/system/login` are covered by the `/system` and `/admin` rule.
- **SR-06 Environment switch**: new variable `PUBLIC_INDEXING_ENABLED`, default `false` (fails closed).
  - `false`: every response carries `X-Robots-Tag: noindex, nofollow`, and robots.txt is `User-agent: *` / `Disallow: /`. Used for local, CI, staging and every preview deployment.
  - `true`: the table in section 5 applies. Required in production; the go-live checklist checks it.
  - Staging is also protected by deployment protection (401 for crawlers). That is the real barrier; the header is a second layer.
- **SR-07 robots.txt** (when `PUBLIC_INDEXING_ENABLED=true`):
  ```
  User-agent: *
  Allow: /
  Disallow: /api/
  ```
  - No `Disallow` for `/system` or `/{slug}/admin`. robots.txt is public (it would advertise those paths), and a `Disallow` stops crawlers from reading the `noindex` directive. The header does the job.
  - No CSS/JS blocking rules. No `Sitemap:` line (SR-08).

## 6. Sitemap

- **SR-08 No sitemap.** Reasons: each tenant has one indexable URL, reachable through its own brand queries and links; a platform sitemap would publish the full list of tenant slugs and their status (enumeration and business-confidentiality risk); at fewer than 50 tenants a sitemap adds nothing measurable.
- Revisit only if the owner wants a public directory. Then: root URLs of active tenants only, generated by a job, no tenant in grace or suspended.
- A per-tenant sitemap is not worth doing.

## 7. Metadata per template

Only the root has SEO-relevant metadata. Other pages get a title for accessibility and browser tabs.

- **SR-11 Title (root)**: `{tenant title} | Car rental`. The tenant `title` is limited to 45 characters (assumption A-2), so the tag stays ≤ 60 characters.
- **Meta description (root)**: if the optional tenant field exists (SEO-3, option A), its value (max 160 characters). Otherwise the template: `Book a rental car with {tenant title}. Choose your pickup and return dates, see available cars and pay on site.` Hard maximum 160 characters; longer values are rejected at save, not truncated silently.
- **H1 (root)**: tenant title. One H1 per page. Sections use H2 (e.g. search, contact). Vehicle cards (results, noindex) use H3 for the vehicle name.
- **Open Graph (root)**, **SR-12**:
  - `og:type=website`, `og:site_name={tenant title}`, `og:title` = title tag, `og:description` = meta description, `og:url` = canonical.
  - `og:image`: an absolute URL to a 1200×630 JPEG generated once when the branding is saved (tenant logo centred on the tenant background colour; the tenant title as text when there is no logo). Generated by the existing `sharp` pipeline (ADR-0009); no per-request image work. Platform default image if generation failed.
  - `og:image:alt` = logo alt text, or the tenant title when there is no logo.
  - `twitter:card=summary_large_image`.
  - JPEG rather than WebP because not all social crawlers accept WebP. Verify in the audit.
- **Alt text**, **SR-15**: logo alt text is required when a logo is set (FR-BRD-08). Vehicle photos: `{vehicle name}, {category label}` (e.g. "Fiat Panda, city"), never empty.
- **Error and flow pages**: title `Page not found | RentCar`, `Booking | {tenant title}`, etc. No description needed (noindex).
- **Tenant text in metadata** is plain text, escaped by React, length-capped (title 45, description 160). No HTML, no Markdown, no URLs from tenant input in `<head>`.

## 8. Structured data (JSON-LD)

- **SR-13 Root only**: `AutoRental` (schema.org type, subtype of LocalBusiness). Fields are included only when the data exists:
  - `name` (tenant title), `url` (canonical root), `logo` (absolute URL, if logo), `telephone` (E.164, if stored), `email` (if stored), `currenciesAccepted` (tenant currency), `paymentAccepted` = "Cash, Credit Card" (on-site payment, FR-PUB-07).
  - `address` (PostalAddress) only if SEO-4 = option A and the address is stored.
  - No `openingHours` (not modelled, REQ-8), no `priceRange` (prices vary by vehicle and date), no customer data.
- Implementation rules: `<script type="application/ld+json">`; serialise the JSON with the `<` character escaped as the Unicode escape `<` so tenant text cannot close the script tag; values come from validated fields only.
- Google rich-result eligibility for `AutoRental` was **not confirmed** from a primary source (preliminary search, secondary sources only). The markup is for correctness; do not promise a rich result. Check with the Rich Results Test and the schema.org validator in the audit.
- Not worth doing: `Product`/`Offer`/`Vehicle` on results (dynamic, noindex, date-dependent prices); `AggregateRating`/`Review` (there is no review data, and invented ratings violate Google's guidelines); `FAQPage` (no FAQ content); `BreadcrumbList` (one page); `WebSite` with `SearchAction` (no site search).

## 9. Not worth doing (explicit)

| Item | Reason |
|---|---|
| Sitemap (platform or per tenant) | SR-08: enumeration risk, no benefit below 50 tenants |
| Indexing results or vehicle pages | Dynamic, date-dependent, duplicate content |
| Pagination links and `rel=prev/next` | One results page per tenant |
| robots.txt disallow for admin/system | Advertises paths and hides `noindex` (SR-07); header instead |
| hreflang | English only (F23) |
| Breadcrumbs, FAQ, reviews, Product schema | No content for them (section 8) |
| Per-tenant favicon | Platform favicon is enough |
| Per-tenant indexing toggle | Indexing follows tenant status (section 5); no extra flag in phase 1 |
| Blog, content marketing, backlinks | No marketing site in scope (requirements §3.3 and discovery) |
| Analytics or tag manager for SEO | Would add third-party requests and cookies, against FR-PUB-13 and NFR-GDPR-07 |
| Bing Webmaster Tools | Low value for a non-marketing product at this stage |

## 10. Tenant states and HTTP behaviour (summary)

- **Unknown slug**: real 404 status with a generic page and noindex. Never a 200 page that says "not found" (soft 404).
- **Suspended** (FR-SYS-12): 200 with the neutral "temporarily unavailable" page and the tenant's contact details, no search form, `noindex, nofollow` (FE-1). Reactivation returns the normal page on the next request, because tenant state is not cached (ADR-0014).
- **Past grace or cancelled** (FR-SYS-13): 200, "bookings unavailable" with contact details, no search form, `noindex, nofollow`. Existing bookings stay valid (their confirmation pages remain available as noindex).
- **Terminated** (FR-SYS-16): same as suspended (200, noindex) until the deletion date. After hard deletion, the slug is a tombstone and returns 404 (FE-1; 410 not used).
- Consequence accepted under FE-1: Google does not get a 503 signal during a suspension; a suspended tenant's page is dropped from the index by the noindex on the next crawl. Reactivation brings it back on a later crawl.
- **Renewal** lifts the state on the next request (US-012).
- **SR-09** Status codes are the real protocol status everywhere, with the FE-1 rule: a tenant page that exists (active, grace, read-only, suspended, terminated) returns 200; an unknown or deleted slug returns 404. No 503 and no 410 anywhere. No 200 for errors, no 302 to a generic home page.

## 11. Security and privacy interactions

- Confirmation URLs contain a booking code. Required: `noindex`, `Cache-Control: no-store`, and `Referrer-Policy: no-referrer` on the confirmation page so the code does not leak through outbound links. This is a request to security-engineer, who owns headers (SR-16, to confirm in their document).
- Tenant text in title, description and JSON-LD: escaped, length-capped, plain text (sections 7 and 8). Matches security-constraints §9.
- Host header: never used for canonical or Open Graph (SR-03, SR-10).
- Customer data must not appear in any indexable page. The root page shows no bookings and no customer data by design.

## 12. Performance and Core Web Vitals (shared budget with frontend)

Targets for the public flow (`/{slug}`, results, booking form), mobile, 4G simulated, 30 vehicles, p75, measured by Lighthouse CI on staging (NFR-PERF-01).

- **SR-14**:
  - LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms (NFR-PERF-01, unchanged).
  - Server response (TTFB) p75 ≤ 800 ms for `/{slug}` (SEO addition; the requirements have no TTFB target). Measured on staging, not in production.
  - First-load JavaScript on the root ≤ 150 kB gzipped (proposal to frontend-developer; to confirm in 07-frontend.md).
- Concrete rules for frontend, to keep the budget:
  - No hero image. The LCP element is the H1 or the logo. Logo as WebP ≤ 480 px wide, `width`/`height` set, `fetchpriority=high`.
  - Vehicle images: 480 px WebP (NFR-PERF-01); the first two cards eager, the rest lazy.
  - Fonts: only the selected family is loaded (ADR-0012), preloaded, `font-display: swap`, fallback metrics matched to avoid layout shift.
  - Reserve space for images and the results block (CLS).
  - Native `input type="date"` and `type="time"` where they fit the mobile design (less JavaScript, better for INP). Final call with ux-designer.
  - No third-party requests on public pages (FR-PUB-13).
- Field data (Chrome UX Report, Search Console Core Web Vitals report) will not exist for low-traffic tenants. Lab data is the only measure in phase 1.
- Cold start on the production database can add latency to the first request after idle (ADR-0010, spike S1). See SEO-6.

## 13. Migration

Not applicable. The product is greenfield (discovery A5); there is no existing site, no URLs to map and no redirects to write. Tenants' own websites that link to `/{slug}` need no action from us.

## 14. Measurement

- **Google Search Console**: one domain property for the platform origin, verified with a DNS TXT record (no script on public pages). Used to check indexing of the root, unexpected indexed URLs, and 404 or 5xx errors. Per-tenant properties only when a tenant has a custom domain.
- **No analytics and no cookies** for public pages (FR-PUB-13, NFR-GDPR-07). Business KPIs come from the database (bookings per tenant, NFR-OBS-02) and structured events without PII (NFR-OBS-01).
- Check after go-live: index coverage weekly for 4 weeks, branded queries from Search Console.

## 15. Go-live checks (input for the audit, `docs/reviews/seo-audit.md`)

- `PUBLIC_INDEXING_ENABLED=true` in production; `false` in staging and previews.
- Production root: `index, follow`, one canonical equal to `{APP_BASE_URL}/{slug}`, no `X-Robots-Tag` noindex.
- Staging and previews: `X-Robots-Tag: noindex, nofollow` and deployment protection on every response.
- Unknown slug → 404 (not 200). Hard-deleted slug → 404. Suspended or terminated → 200 with `noindex, nofollow` and the neutral page. No 503 and no 410 anywhere (FE-1).
- robots.txt reachable; no sitemap line.
- Title, description and H1 on the root; OG tags with image URL that returns 200 and is a JPEG.
- JSON-LD valid on the root; no fields with placeholder values.
- Public HTML without JavaScript contains the H1, the contact block and the search form.
- Lighthouse CI on `/{slug}` meets SR-14.

Verification method: HTTP status and headers with `curl` (no browser needed); rendered metadata and Open Graph with a headless browser (Playwright, already in the toolchain); Lighthouse CI for CWV; Rich Results Test for JSON-LD.

## 16. Requirement changes proposed to 02-requisiti.md (for PM and requirements-analyst)

- **FR-PUB-14** (currently S): split. The `noindex` and status-code rules (SR-05, SR-09) become **M** because they protect customer and booking data. The title and description rules stay S.
- **FR-BRD-01**: add "title max 45 characters" (A-2). Description field only if SEO-3 = A.
- **FR-BRD-09 / FR-BRD-08**: address and short description as optional tenant fields (only if SEO-3 and SEO-4 = A).
- **New environment variable** `PUBLIC_INDEXING_ENABLED` (SR-06): add to `.env.example` and the typed config (ADR-0001, FR-PLT-09).
- **NFR-PERF-01**: add the TTFB target and the JavaScript budget (SR-14).

## 17. Assumptions

| ID | Assumption | To confirm with |
|---|---|---|
| A-1 | Booking form and confirmation are sub-paths of `/{slug}` (or query state). Any public HTML path other than the exact root is noindex, whatever the route names are. | frontend-developer |
| A-2 | Tenant `title` ≤ 45 characters (new validation). | requirements-analyst |
| A-3 | Tenant contact data includes phone and email. Postal address is not modelled today (see SEO-4). | requirements-analyst |
| A-4 | Logo is PNG, JPEG or WebP ≤ 1 MB (FR-BRD-08); the OG image is generated from it with `sharp`. | backend-developer |
| A-5 | One canonical origin per environment (`APP_BASE_URL`). Vercel default hostnames are not used publicly (devops to confirm or redirect them). | devops-engineer |
| A-6 | Search is GET with query parameters (frontend choice; SEO-neutral). | frontend-developer |
| A-7 | Search Console is verified with a DNS TXT record on the platform domain. | owner |

## Domande per l'utente

| ID | Domanda | Opzioni (la prima è raccomandata) | Perché conta / impatto | Bloccante |
|---|---|---|---|---|
| SEO-1 | Vuoi che la pagina di prenotazione di ogni noleggiatore possa essere trovata su Google (ricerca per nome dell'attività)? | A (raccomandata): sì. La pagina principale di ogni noleggiatore è indicizzata con titolo e descrizione; le pagine di prenotazione, i risultati e la conferma restano fuori da Google / B: no. Tutto in noindex: massima riservatezza, nessuna visibilità organica, lavoro SEO quasi nullo | Con A il lavoro in più è piccolo (titolo, descrizione, dati strutturati di base). Con B nessuno trova il noleggiatore da Google, ma le pagine restano comunque pubbliche per chi ha il link | no |
| SEO-2 | L'interfaccia resta in inglese (decisione F23), ma i clienti italiani cercano in italiano. Come gestiamo la lingua della pagina pubblica? | A (raccomandata): interfaccia in inglese. Ogni noleggiatore può scrivere una descrizione breve nella propria lingua (vedi SEO-3) / B: riaprire la decisione e tradurre la pagina pubblica in italiano | B è un lavoro di traduzione e di i18n più grande e cambia una decisione già presa in discovery. A mantiene il piano, ma lascia la descrizione nelle mani del noleggiatore | no |
| SEO-3 | Aggiungiamo un campo facoltativo "descrizione breve" (max 160 caratteri) nelle impostazioni del noleggiatore? | A (raccomandata): sì, facoltativo; se è vuoto si usa un testo automatico in inglese / B: no, solo il testo automatico | A aggiunge un campo al modulo delle impostazioni (piccolo lavoro, un campo in più da validare). Il testo del noleggiatore è quello che Google mostra nei risultati | no |
| SEO-4 | Aggiungiamo l'indirizzo del noleggiatore (via, CAP, città) come campo facoltativo? | A (raccomandata): sì, facoltativo. Serve per i dati strutturati e per le ricerche locali tipo "noleggio auto <città>" / B: no, solo telefono ed email | La città è il segnale principale per le ricerche locali. L'indirizzo di un'impresa è dato pubblico. Costa un campo e la validazione | no |
| SEO-5 | Superata da FE-1 (2026-11-03): un noleggiatore sospeso o terminato restituisce 200 con noindex e pagina neutra; nessun 503 e nessun 410. Nessuna domanda aperta. | — | — | no |
| SEO-6 | Il database di produzione si sospende quando è inattivo (piano a consumo, ADR-0010). Il primo visitatore dopo un periodo di inattività aspetta circa 1 secondo in più. Accettiamo questo? | A (raccomandata): sì, risparmiamo sul costo. Misuriamo nello spike S1 e rivediamo se il tempo di risposta supera 800 ms / B: no, il database resta sempre attivo | Il costo mensile della opzione B va quantificato da devops (non ancora stimato). Impatta il primo caricamento e la lentezza percepita sulla pagina principale | no |

## Esito
- **Stato**: completato
- **File prodotti/modificati**: `/Users/ermaaga/Work/RentCar/docs/09-seo.md`
- **Sintesi**:
  1. Only `/{slug}` (root, no query) is indexable; results, booking form, confirmation, error and unavailable states are `noindex`.
  2. Canonical is `{origin}/{slug}` built by `canonicalUrl(tenant, path)`, never from the Host header; custom-domain rules (301 from platform origin, host policy) are specified but not built.
  3. Status codes (FE-1): 200 active; 200 + noindex past grace, cancelled, suspended or terminated; 404 unknown or hard-deleted slug. No 503, no 410.
  4. Environment switch `PUBLIC_INDEXING_ENABLED` (default false) controls indexing; staging and previews are noindex and protected.
  5. No sitemap (enumeration risk, no benefit below 50 tenants); robots.txt does not disallow admin or system paths.
  6. Root metadata: title `{tenant title} | Car rental`, description (tenant or template), OG with a generated 1200×630 JPEG from the logo, JSON-LD `AutoRental` with present fields only.
  7. Core Web Vitals per NFR-PERF-01, plus TTFB ≤ 800 ms p75 and a 150 kB JS budget as proposals for frontend.
  8. Not worth: sitemap, results indexing, FAQ/review/product schema, hreflang, analytics, migration work (greenfield).
- **Assunzioni**: A-1 to A-7 (section 17). Booking form is a sub-path or query state of the root (A-1); title ≤ 45 characters (A-2).
- **Rischi**:
  - Google rich-result eligibility of `AutoRental` not confirmed (media, low impact).
  - Cold start on the production database hurts first-load and TTFB on the only indexable page (media; SEO-6).
  - English-only UI in an Italian market limits organic reach (media; SEO-2).
  - Forgetting `PUBLIC_INDEXING_ENABLED=true` in production makes the whole platform invisible; forgetting `false` on staging leaks staging into Google (media, go-live check).
  - The Vercel default hostnames serve the app and could duplicate the canonical site (low, host policy SR-10).
- **Rilievi bloccanti**: nessuno (documento di requisiti, non una review).
- **Criteri non verificati**: non applicabile. Il documento definisce requisiti; nessun comportamento del sistema è stato verificato perché il codice non esiste ancora. Le verifiche sono previste in `docs/reviews/seo-audit.md` (sezione 15). Le fonti di ricerca preliminare sono secondarie (vedi sotto).
- **Modifiche richieste a 02-requisiti.md** (da instradare al project manager): FR-PUB-14 da S a M per le regole noindex e di stato; FR-BRD-01 con titolo massimo 45 caratteri; nuova variabile `PUBLIC_INDEXING_ENABLED`; NFR-PERF-01 con TTFB e budget JS.
- **Coordinamento**: security-engineer deve confermare le intestazioni della conferma (`Referrer-Policy: no-referrer`, `Cache-Control: no-store`) e la conferma dell'escaping JSON-LD (sezione 11). ux-designer deve confermare il modulo di ricerca (input nativi data/ora, GET) e il testo alternativo delle foto veicolo (sezione 7).
- **Fonti (ricerca preliminare, secondarie)**:
  - https://frontendchecklist.io/rules/seo/robots-meta-conflict
  - https://www.kayak.com/Italy-Car-Rentals.118.crc.html
  - https://ahrefs.com/websites/kayak.it (traffico di terzi, non verificato)

## Domande per l'utente (riepilogo)
Vedi la tabella sopra: SEO-1 (indicizzazione), SEO-2 (lingua), SEO-3 (descrizione), SEO-4 (indirizzo), SEO-6 (cold start). SEO-5 è superata dalla decisione FE-1. Nessuna domanda è bloccante: le opzioni raccomandate sono già scritte nel documento.

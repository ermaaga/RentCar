# Frontend: RentCar

Version 1.0 · 2026-11-01 · Owner: frontend-developer · Phase 4, wave B (last analysis document) · Status: analysis, no code
Inputs: `docs/03b-struttura-codice.md` (binding), ADR-0001/0012/0014/0015, `docs/04a-ux.md`, `docs/04b-ui-design.md` (direction Clear + 3 borrowings), `docs/design/tokens.json`, `docs/design/clear/*.html`, `docs/06-backend-api.md`, `docs/08-security.md` (SR-HDR, SR-SES, decisions 5.1/5.4), `docs/09-seo.md`, `docs/10-test-plan.md`, `docs/02-requisiti.md` v1.3/1.4, `docs/12-osservabilita.md`.
Language rule: this document is in English (user decision 2026-11-01); identifiers, keys, file names and test names are in English. Paths under `src/` are **planned** (greenfield project, 03b TD-1); the first task that creates a pattern places it exactly where indicated.

---

## 0. Summary decisions

| ID | Decision | Why (discriminator) |
|---|---|---|
| FE-D1 | **Everything dynamic, no ISR/SSG/Data Cache on tenant pages.** Server Components by default; client JS only in small interactive "islands". | ADR-0014 (suspension effective on the next request), CSP with per-request nonce (forces dynamic rendering), SEO SR-02 |
| FE-D2 | **The public root page `/{slug}` has no client components of its own**: native `<form method="get">` search form, contacts as an `#contact` anchor, no dialog. The JS is only the framework runtime. | 150 kB gzip budget (SR-14/NFR-PERF-01): the App Router runtime already takes most of it (to be measured in M0, spike S-FE-1) |
| FE-D3 | **No server-state library (TanStack Query/SWR) in v1.** Reads = RSC; URL = view/filter state; mutations = server action + `router.refresh()` in a transition. "Live" reads from the client (contrast preview, slug check, customer suggestions, booking change preview) = `read` server actions with a minimal `useActionQuery` hook. | A client cache is one more thing to keep coherent with RLS/roles/suspension; ~13 kB saved; no requirement asks for a client cache |
| FE-D4 | **Forms: react-hook-form + `zodResolver` with the same Zod schemas as `application/schemas.ts`** (messages = catalog keys), one pattern (`FormShell`). Single exception: the root search form (native GET). | Section 6 (alternatives evaluated) |
| FE-D5 | **Tailwind CSS v4 (CSS-first) + shadcn/ui + Lucide; tokens generated from `tokens.json`** into `tokens.css` and `@theme`; the tenant theme overrides the same variables via `/{slug}/theme.css`. **No `data-theme` and no script for the theme**: the tenant-forced mode is emitted inside `theme.css`. | Strict CSP, no flash, no cookie/storage (section 7) |
| FE-D6 | **Actions injected as props** by pages (`app/`) into `modules/*/ui` components: the UI never imports `app/actions`. | 03b layers: `ui` cannot import `app/`; DI by props/Context |
| FE-D7 | **Calendar without virtualization in v1** (<= ~60 vehicles x 31 days), `content-visibility: auto` on rows; ARIA grid with roving tabindex; Agenda as a real list. | Section 8 |
| FE-D8 | **No inline styles**: the JSX `style` prop is forbidden (lint + Semgrep); dynamic values = enumerated classes or CSS variables set via CSSOM by a single hook. Goal: `style-src` without `style-src-attr` (decision 5.1). | Section 7.4 |
| FE-D9 | **The client never reads the clock to show "today" or deadlines**: everything comes from the server as strings/durations (`todayLocal`, `idleExpiresInMs`). | Deterministic tests with the CI clock (section 16.4) |
| FE-D10 | **No analytics, no RUM, no browser SDK, no cookie banner** in v1. Core Web Vitals measured in the lab (Lighthouse CI + Playwright). | FR-PUB-13, SR-GDPR-02, SR-LOG-08, `12-osservabilita.md` |

---

## 1. Rendering strategy by route group

Next.js App Router, Node runtime. All pages read headers/nonce per request: they are dynamic by construction. We do not use `export const revalidate`, `unstable_cache`, cached `fetch`, per-tenant `generateStaticParams`, or PPR. `next.config`: `poweredByHeader: false`, `output: 'standalone'`, `experimental.staleTimes.dynamic = 0`, `images.unoptimized = true` (WebP variants are produced by the `sharp` pipeline, ADR-0009: no `/_next/image` endpoint), `experimental.optimizePackageImports: ['lucide-react']`, `serverActions` as in 06 (backend configures them).

| Group | Routes | Strategy | Indexing | Why |
|---|---|---|---|---|
| Public | `/{slug}` | **Dynamic SSR, minimal streaming**: all SEO content (title, description, canonical, H1, contacts, form) is in the initial HTML; zero client components of its own (FE-D2) | `index, follow` only if `PUBLIC_INDEXING_ENABLED=true` and tenant active/grace | SEO SR-02; TTFB p75 <= 800 ms |
| Public | `/{slug}/vehicles`, `/book`, `/booking/{code}` | **Dynamic SSR** with `loading.tsx`; client islands: filters sheet, booking form | `noindex` (meta + header) | Personal/parametric data, no-store on the confirmation |
| Public | `/{slug}/privacy`, `/terms` | Dynamic SSR, tenant text **escaped plain text only** (decision 5.4) | `noindex` | XSS on a shared origin |
| Public (assets) | `/{slug}/theme.css`, `/media/*`, `*/pdf` | Route handlers (backend): immutable/versioned | no directive | ADR-0012/0009 |
| Tenant admin | `/{slug}/admin/**` | **Dynamic SSR + client islands** (shell, forms, calendar, sheets). No SPA: every page is an RSC calling the service | `X-Robots-Tag: noindex` (central) | Private area, SEO irrelevant, but SSR avoids waterfalls and delivers data already filtered by role |
| Auth | `/{slug}/admin/login`, `forgot-password`, `reset-password`, `activate`; `/system/login`... | Dynamic SSR, minimal client form; `Referrer-Policy: no-referrer` (central header) | noindex | Token pages: `peekCredentialLink` on GET (read-only), POST by the action (06 X5) |
| System | `/system/**` | Dynamic SSR + islands, platform theme (no `theme.css`) | noindex | FR-UX-13 |
| Tenant states | not active | The `[slug]` layout resolves the state **before** any Suspense (so the HTTP status can still be changed). 404 = `notFound()`. **410 and 503 cannot be expressed from an RSC**: see risk R-FE-1 and spike S-FE-2 | `noindex, nofollow` | 09-seo section 5 |

Ordering rule (so statuses are honored): the `[slug]` `layout.tsx` does `await resolveTenant()` and decides `notFound()`/state page; **no `loading.tsx` and no `<Suspense>` above or inside the layout before that decision**. `loading.tsx` exists only at page level (child segment) and does not wrap the layout.

---

## 2. Route tree, layouts and boundaries

Follows 03b (`(public)/[slug]`, `(tenant)/[slug]/admin`, `(system)/system`). A single root `app/layout.tsx` with `<html lang="en">`; `/system` and `/media` are static segments that win over `[slug]`; reserved slugs (ADR-0012) cover the rest.

```
src/app/
  layout.tsx                  html lang=en, body, tokens.css + globals.css, SkipLink, ToastRegion, MessagesProvider(common)
  not-found.tsx               generic 404 (unknown URLs), noindex
  global-error.tsx            last resort (client), reference = digest
  (public)/[slug]/
    layout.tsx                resolveTenant -> state; <TenantTheme> (theme.css link + font preload); PublicShell (header 60, footer); BookingDraftProvider (memory only)
    page.tsx                  W-P1 Search + contacts + JSON-LD   [no client component]
    vehicles/{page,loading,error}.tsx      W-P2 (+ FiltersSheet client)
    book/{page,loading,error}.tsx          W-P3
    booking/[code]/{page,loading}.tsx, not-found.tsx   W-P4 (no-store, noindex)
    privacy/page.tsx, terms/page.tsx       plain text | external link
    theme.css/route.ts, booking/[code]/pdf/route.ts    (backend, 06 7.1)
    not-found.tsx, error.tsx               W-P5, S-R
  (tenant)/[slug]/admin/
    layout.tsx                resolveTenant, frame shell (NavShell, BannerRegion, SessionClock); does NOT do auth by itself
    (auth)/login|forgot-password|reset-password|activate/page.tsx     no nav, centered card
    (app)/page.tsx            W-D1 Today                (loading.tsx, error.tsx)
    (app)/calendar/page.tsx   W-D2                      (loading.tsx, error.tsx)
    (app)/bookings/{page,new/page,[code]/page,[code]/edit/page}.tsx   (loading, error, not-found)
    (app)/vehicles/{page,new,[id],[id]/edit,[id]/expenses}/...
    (app)/customers|operators|revenue(+compare)|settings(+branding,booking-rules,legal,contact,email)|activity|account/...
    exports/*, vehicles/[vehicleId]/photos, settings/logo      route handlers (backend)
  (system)/system/
    layout.tsx                platform shell (drawer on phone, sidebar from lg)
    login|forgot-password|reset-password, tenants (+new, [slug]), activity, account
  api/, media/, exports/, robots.txt/   (backend)
  actions/<module>/*.ts       server actions (backend; the UI does not import them)
```

**Boundaries per segment**
- `loading.tsx`: skeleton with the **same dimensions** as the final content (CLS), shown after 300 ms (`motion.duration.skeletonDelay` token, CSS `animation-delay`, no JS), `aria-busy="true"` and hidden text "Loading {thing}". Present on every page with queries (all except root, auth, legal).
- `error.tsx` (client) per group and for data pages: `ErrorState` (icon, reason, "Try again" = `reset()`, reference = `error.digest`). Section-level errors (e.g. one Today panel) use **`<SectionBoundary>`** (React error boundary in the `ui` component) so the rest of the page stays usable (04b section 13).
- `not-found.tsx` per group: same page for a missing id and an id of another tenant (S-F); "Back to ..." link to the group home.
- `global-error.tsx`: minimal HTML with no dependency on the theme (platform tokens.css).
- **Auth per page, not per layout**: Next layouts are not re-executed on every client navigation. Every admin/system `page.tsx` starts with `const actor = await requireStaffPage({ scope, minRole })` (wrapper in `platform/http`, calls `Guard`; redirects to login with `?next=` validated by `safeNextPath()`, only `/{slug}/admin/...` paths). The architecture test on the route registry (06 3.2) also covers pages. The layout uses the role only to choose nav items (the role does not change within a session).
- **Banners and `SessionClock` live in an `AdminPage` wrapper rendered by every page** (not in the layout), so they are re-evaluated on every navigation (subscription state, session countdown).
- Top bar title on phone: `TopBarTitle` (client) reads `usePathname()` and a static route -> catalog key map; the real H1 belongs to the page.

**Metadata**: every page exports `generateMetadata` (title "{Page} · {Tenant title}", robots, canonical). The `[slug]` layout sets the default `robots: { index: false, follow: false }`; only `/{slug}` overrides it (and only if `PUBLIC_INDEXING_ENABLED`). `metadataBase = APP_BASE_URL` (via injected config). The `X-Robots-Tag` header is central (middleware/header class), the meta tags are belt and braces. JSON-LD `AutoRental` only on the root, through `<JsonLd data>` (serializes with `<` -> `<`; values only from validated fields). No `sitemap.xml` (SEO SR-08).

---

## 3. Server vs client rules

1. **Default = Server Component.** `'use client'` only for: interactive local state, handlers, browser APIs (File/Canvas/matchMedia/IntersectionObserver), RHF forms, stateful Radix (Dialog, Sheet, Select, DropdownMenu, Tabs).
2. **The client boundary goes through the leaves**: RSC page -> presentational `ui` component (RSC) -> small client island. Never `'use client'` on a whole page or layout (exceptions: `error.tsx`, `global-error.tsx`).
3. **Data to client components only as serializable DTOs** (06 3.6: ISO strings, amounts in minor units, no ids of other tenants, no hashes). No `tenantId` in props. Dates already as tenant-local strings (`startLocal`) + UTC ISO where comparison is needed.
4. **Never import from client code** `platform/*`, `infrastructure/*`, `application/*` (except `schemas.ts` and DTO types: clarification request to 03b, FE-7), `composition/`. `modules/<m>/ui` imports: DTOs/types and schemas from its own module's `application`, `shared/`, `src/ui`, `src/i18n`. Dedicated dependency-cruiser rule: `ui -> application` allowed only for `schemas.ts` and `dto.ts`, and those two files may import nothing outside `shared/`.
5. **Actions as props (FE-D6).** Example: `app/(tenant)/[slug]/admin/(app)/vehicles/new/page.tsx` imports `createVehicle` from `app/actions/fleet/create-vehicle` and renders `<VehicleForm action={createVehicle} />`; `VehicleForm` (client, in `modules/fleet/ui`) receives `action: (input: CreateVehicleInput) => Promise<ActionResult<VehicleDto>>`. Tests pass a fake. For deep reads (preview, suggestions) a feature Context is used (`BookingFormServicesContext`) populated by the page.
6. **Tenant context for the UI**: `TenantUiProvider` (client, in `src/ui/tenant`) exposes `{ basePath, title, timeZone, currency, countryCode }` and `useTenantUrl()`. All links go through `tenantUrl()` (ADR-0012); lint: template-literal `href={`/${...}`}` forbidden.
7. **No `window.localStorage`/`sessionStorage`/cookies** on public pages and for personal data (SR-HDR-03). Single proposed exception: calendar view preference (not sensitive), see FE-4.
8. **No `dangerouslySetInnerHTML`, `v-html`, `innerHTML`** (Semgrep). Tenant text always as JSX children (automatic escaping), `white-space: pre-line` for line breaks. Single exception: `JsonLd` (`application/ld+json` script, dedicated and tested serializer).
9. **No calls to the clock** (`Date.now`, `new Date()`, `performance.timeOrigin` for product logic): ESLint rule already in 03b (extended to client code). Countdown = `setTimeout/setInterval` on relative durations received from the server.
10. **Hydration safety**: date/amount formatting always with the tenant's explicit timezone and currency (`shared/format`, reuse, do not recreate): no argument-less `toLocaleString()` (lint `no-restricted-syntax`). No `typeof window` in render.

---

## 4. Frontend code structure (inside the 03b layout)

```
src/ui/                          shared design system (reuse, one file per component)
  components/ui/                 shadcn copies adapted to the tokens (button, input, dialog, sheet, tabs, ...)
  form/                          FormShell, FormField, ErrorSummary, StickyActionBar, useZodForm, applyActionResult
  states/                        EmptyState, ErrorState, SectionBoundary, Skeleton*, StatusBanner, BannerRegion
  layout/                        PublicShell, AdminShell, NavShell, BottomNav, SideNav, Sidebar, PageTitle, AdminPage
  data/                          DataTable + ResponsiveList (table md+, cards <md), Pagination, FilterBar, useUrlFilters
  tenant/                        TenantUiProvider, TenantTheme (server), useTenantUrl
  session/                       SessionClock, SessionTimeoutDialog, SessionExpiredDialog, useActionRunner
  calendar/                      CalendarGrid, CalendarBar, useRovingGrid (generic: reusable by other grids)
  hooks/                         useActionQuery, useCssVars, useFileDownload, useUnsavedChangesGuard, useMediaQuery (behaviour only, never for layout)
  lib/                           downscale-image.ts, upload-blob.ts, safe-next-path.ts, json-ld.ts
src/i18n/                        messages/en/<namespace>.ts (aggregated in en.ts), index.ts (getTranslator, useT), pseudo.ts
src/styles/                      tokens.css (generated), theme.generated.css (@theme, generated), globals.css, fonts.css, calendar.css
src/modules/<m>/ui/              feature components (e.g. booking/ui: AvailabilityResults, BookingForm, BookingEditForm, ChangesPanel, QuickView, CalendarPage...)
```

Module -> main components (reuse before creating: shared `ui` only at the 3rd duplication, rule of three in 03b):

| Module | `ui/` (feature) | Notes |
|---|---|---|
| `booking` | `SearchForm` (server), `ResultsList`, `FiltersSheet`, `PublicBookingForm`, `ConfirmationPanel`, `TodayView`, `CalendarView` (+ `DayView`, `MonthView`, `AgendaList`, `GridView`), `QuickView`, `BookingsTable`, `BookingDetail`, `BookingEditForm`, `ChangesPanel`, `PaymentSheet`, `StatusActionsMenu`, `use-availability-search.ts` (reference hook 03b) | `StatusChip`/`PaymentChip` in `src/ui` (used by 3+ modules) |
| `fleet` | `VehicleCard`, `VehicleForm` (reference 03b), `PhotoManager`, `VehicleTable`, `MaintenanceToggle` | upload via shared `uploadBlob` |
| `branding` | `BrandingForm`, `ContrastPanel`, `ThemePreview`, `ColorField`, `FontPicker` (RadioCard), `LogoUpload` | preview: section 7.5 |
| `auth` | `LoginForm`, `ForgotPasswordForm`, `SetPasswordForm`, `AccountPage`, `SessionsList`, `OperatorsTable`, `OperatorForm` | same `FormShell` |
| `tenancy` | `TenantsTable`, `CreateTenantForm`, `TenantDetailSections`, `SettingsForms` | system + admin |
| `finance` | `RevenueOverview`, `MonthlyTable`, `CompareYears`, `ExpensesList`, `ExpenseSheet`, `SnapshotHistory` | no charts in v1 |
| `customers`, `audit`, `notifications`, `subscriptions` | tables/details; subscription banner in `subscriptions/ui/SubscriptionBanners` | |

**Reference patterns** (to be recorded in the 03b section 6 table in the same commit): server component `modules/fleet/ui/vehicle-card.tsx`; client form `modules/fleet/ui/vehicle-form.tsx` (already planned); hook `modules/booking/ui/use-availability-search.ts` (already planned); `ui/form/form-shell.tsx` as the reference for all forms.

---

## 5. Data, cache and mutations

### 5.1 Reads
- An RSC page calls the service query directly (06 7.3), after `requireStaffPage`/`resolveTenant`. No internal `fetch`, no BFF. Independent queries run in parallel with `Promise.all`; slow sections go behind `<Suspense>` with a section `ErrorBoundary` (e.g. Today: counters immediately, "needs attention" streamed).
- **Cache**: only per-request `React.cache` (tenant, session, config; ADR-0014). No Data Cache, no ISR. Client router cache with `staleTimes.dynamic = 0`: every navigation reloads.
- **URL state** (06/UX): calendar view and date, list filters/sort/page, public search query. Parsed with the Zod schemas `pageParams`/specific ones (`parseSearchParams(schema, searchParams)` in `ui/data`); invalid parameters: public root shows the form with an error (UX 4.1), admin falls back to defaults. `useUrlFilters(schema)` updates the URL with `router.replace` inside `startTransition` (the old list stays visible with `aria-busy`, text search debounced 300 ms).
- **Client reads (`useActionQuery`)**: for `previewContrast`, `checkSlugAvailability`, `suggestCustomers`, `previewBookingChange`, live availability in the admin form. Hook: debounce, **last request wins** (sequence token, no `AbortController` because server actions do not support it), state `idle | loading | ok | error`, typed `ActionResult` result, `role="status"` region for the outcome. ~60 lines, no dependency.

### 5.2 Mutations
Single wrapper `useActionRunner()` (in `ui/session`): `run(action, input) -> ActionResult` inside `useTransition`, with:
1. `isPending` per button ("Saving…", width unchanged, `aria-disabled`, never disabled merely because invalid);
2. network exception handling (the server action throws): converted to `{ ok:false, code:'NETWORK' }` -> S-O "You seem to be offline. Your changes are still here." with Retry, data kept;
3. `UNAUTHENTICATED` -> `SessionExpiredDialog` (S-T): in-place login, then **one** retry of the stored thunk, form state in memory;
4. `TENANT_READ_ONLY`/`TENANT_UNAVAILABLE` -> banner and `aria-disabled` controls with reason; `MUST_CHANGE_PASSWORD` -> redirect to `account`;
5. `ok` -> `router.refresh()` in the same transition (reloads RSCs without losing client state) and/or `router.push` where the UX requires; **success-only** toasts (Sonner, text from `feedback.*`), never the only channel for errors.

**Error code -> UI treatment table** (`ui/states/error-presentation.ts`, reuses the `messageKey` arriving in the result; only the *treatment* is defined here):

| Codes | Treatment |
|---|---|
| `VALIDATION_FAILED` + `fieldErrors` | `setError` per field, `ErrorSummary` with focus (UX 8.1.3) |
| `BOOKING_CONFLICT`, `VEHICLE_TAKEN`, `VEHICLE_IN_MAINTENANCE`, `PLATE_TAKEN`, `PLAN_LIMIT_REACHED` | S-X banner at the top of the form (`role="alert"`), data kept, link to the conflicting booking (staff only), scroll to the section |
| `PRICE_CHANGED` | warning banner, new total in the button ("Confirm at €135.00"), focus on the banner (UX W-P3) |
| `BOOKING_STALE`, `STALE_RECORD` | "changed by someone else" banner + "Reload latest" that reloads data **without** losing the user's edits (shown in the Changes panel) |
| `IMPACT_CONFIRMATION_REQUIRED` | opens `AlertDialog` with the impacts (`params.impacts`), confirming re-runs with `acknowledgeImpact: true` |
| `RATE_LIMITED` | inline message + `retryAfterSeconds` (text, no animated countdown) |
| `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE` | generic message + `requestId` as reference, form intact, Retry |
| `CONTRAST_TOO_LOW`, `LOGO_ALT_REQUIRED` | next to the Save button (not only in the panel), UX/UI 4.3 |
| `UPLOAD_*` | on the photo row with a catalog message |

### 5.3 Optimistic vs pending
Only where the operation is idempotent, has no plausible conflicts and has a trivial rollback: **`setPayment`** (chip "Paid" + balance, `useOptimistic`, rollback with message on error), **`setCoverPhoto`/`reorderPhotos`** (Move earlier/later), **email toggle** in settings. **Never optimistic**: booking create/edit, status change, maintenance (has an impact dialog), expenses (touch snapshots), anything the server may reject on business rules. For everything else: pending UI (spinner + label) and update only on response.

---

## 6. Form architecture

**Alternatives evaluated**

| | A. RHF + zodResolver + shared schemas (recommended) | B. native `<form action>` + `useActionState`, server-only validation | C. TanStack Form |
|---|---|---|---|
| On-blur validation and error summary (UX 8.1) | yes, native (`mode: 'onTouched'`, `reValidateMode: 'onChange'`) | needs custom code for blur/summary | yes |
| Reuse of backend schemas | yes, the same Zod from `application/schemas.ts` (messages = keys) | not needed | Zod adapter |
| Dynamic forms (live availability, new/existing customer, sections) | excellent (`useWatch`, `useFieldArray`) | awkward | excellent |
| Client weight | ~9 kB RHF + ~1 kB resolver (+ zod ~13 kB, shared by every form) | 0 | ~12 kB |
| Progressive enhancement without JS | no (actions called with objects, not FormData) | yes | no |
| Maturity/shadcn ecosystem (shadcn `Form` uses RHF) | high | medium | low |

Choice **A**: admin forms are complex and progressive enhancement is not a requirement. The **public root stays native GET** (FE-D2): it does not bring RHF/Zod into the SEO critical path bundle. For consistency (one way of doing forms) login, set-password and settings also use A.

**Components** (`src/ui/form`)
- `useZodForm(schema, { defaultValues })`: `useForm` + `zodResolver`, `mode: 'onTouched'`. Schemas are **text-free factories**: errors are keys (`errors.validation.required` with `params`), `FormField` translates with `useT()`.
- `FormShell`: `<form noValidate>` with `onSubmit` -> `useActionRunner`, **ErrorSummary** (`role="alert"`, receives focus on failed submit, links to fields), form banner (S-X), `StickyActionBar` (Cancel left, Save right, `position: sticky; bottom: 0` **at the end of the form** and not `fixed`, for the iOS keyboard; `scroll-padding-bottom` = `size.sticky-bar`).
- `FormField`: visible label, `aria-describedby` (help + error), `aria-invalid`, icon + text for the error, textual "(optional)", mandatory `autocomplete`/`inputmode` in the props (typed), amounts with `inputmode="decimal"` and `parseMoneyInput` parser (-> minor units, 2 decimals, never `type=number`).
- `applyActionResult(form, result)`: maps `fieldErrors[].field` (dotted path) to `setError`, sets the form-level error, returns the treatment from `error-presentation`.
- `useUnsavedChangesGuard(isDirty)`: `beforeunload` for tab close; for in-app navigation a `NavigationGuard` context consulted by `AppLink` (shell links and Cancel) and by back (`history` sentinel); App Router exposes no route-change events, so coverage is "app links + tab close + back button"; the rest (typed URL) is out of reach. Risk R-FE-4.
- **Idempotency**: the key comes from the server (the page generates it with `IdGenerator` and passes it as a prop; for the public form it is inside the `formToken` from `prepareBooking`). The client does not generate IDs (rule 5 of 03b).
- Public **honeypot**: `website` field off-screen (`position:absolute; inset-inline-start:-9999px` as a class), `tabIndex={-1}`, `aria-hidden`, `autocomplete="off"`; never visible to screen readers.
- **Public booking draft**: `BookingDraftProvider` (React state in the `[slug]` layout) survives client navigations (back to results, conflict), lost on reload. **Not** `sessionStorage`: it contains name and phone (SR-HDR-03). Deviation from the UX wireframe (which foresees sessionStorage), justified by security; FE-8 for confirmation.
- **Double-submit protection**: pending state + server idempotency key (FR-BKG-11).
- **Notes warnings**: `NotesField` component with a persistent "Do not enter card numbers..." warning (catalog text) under the field, used wherever there is a free-text field (FR-DAT-01); the `cardNumber` rule is in the schema.

**Key forms**
- *Admin booking (new/edit)*: sections Dates / Vehicle / Customer / Payment / Notes; live availability uses `useActionQuery(previewBookingChange | searchAvailability)` with `role="status"`; **Changes** panel (old -> new, total, balance) always visible in edit; Customer = `Combobox` (ARIA combobox pattern built with `Popover` + `listbox`, no new dependency) with `suggestCustomers` min 2 characters.
- *Vehicle*: sections; `PhotoManager` with a **sequential** queue (the server has a semaphore of 2 uploads): per file "Resizing… Uploading… Done", counter "3 of 10", buttons Move earlier/later/Set as cover/Remove (no drag, WCAG 2.5.7).
- *Branding*: see 7.5.
- *Create tenant* (system): one page with three numbered cards; live slug check (`checkSlugAvailability`, debounced) with `role="status"`; activation email outcome "sent/failed/no_smtp" shown after saving with "Copy link / Reissue" action.

---

## 7. Theming pipeline

### 7.1 Tokens -> CSS (build)
`scripts/build-tokens.ts` (03b section 12) reads `docs/design/tokens.json` (single source) and generates, **committed**, with a CI-verified diff:
- `src/styles/tokens.css`: `:root { --background:#F6F8F9; ... }` (light), `@media (prefers-color-scheme: dark) { :root { ... } }` (dark), plus non-colour variables (`--radius-*`, `--shadow-*`, `--font-family-sans`, `--touch-h`, `--size-*`, `--ring-width`, motion durations). For `/system`, unbranded auth pages and tenants without branding this is the platform theme.
- `src/styles/theme.generated.css`: `@theme inline { --color-background: var(--background); --color-primary: var(--primary); ... --radius-md: var(--radius-md); --spacing-*: ... }` (Tailwind v4). So `bg-primary`, `text-muted-foreground`, `border-border-strong`, `ring-ring` are semantic classes; `bg-primary/50` works via `color-mix`.
- Roles beyond shadcn: `primary-soft(-foreground)`, `accent-soft`, `link`, `border-strong`, `disabled-*`, `success|warning|danger|info` (+ `-soft`, `-border`) mapped 1:1; shadcn aliases as in 04b 4.1 (`destructive = danger`; `popover|dialog|sheet = card`).
- Alignment note: 03b section 12 writes `hsl(var(--primary))`, but the tokens are **hexadecimal**: plain `var(--primary)` is used (FE-3 / request to 03b).

**Density**: variables defined *once* in `tokens.css` with a media query: `--control-h: var(--size-touch)` below 768 px or `(pointer: coarse)`, `var(--size-pointer)` otherwise; `--today-row-h: 48px`. Components use `h-(--control-h)`; no per-component density media queries (functional equivalent of the `data-density` attribute of 04b section 9, at zero JS cost and with no flash).

**Bans (lint + Semgrep, 03b section 12)**: no hex or `bg-[#...]`, no default Tailwind colour classes (`bg-red-500`: Tailwind palettes are disabled with `--color-*: initial` before `@theme`), no `style=`.

### 7.2 Tenant theme at runtime
`GET /{slug}/theme.css?v={themeVersion}` (backend route handler, `renderThemeCss(deriveTheme(...))`, immutable). The frontend:
- in the `[slug]` layout (server) renders `<link rel="stylesheet" href={themeUrl} precedence="tenant-theme" />` (React 19: no inline `<style>`, no nonce needed because same-origin, blocks rendering until loaded -> no FOUC) and `ReactDOM.preload(fontUrl, { as:'font', type:'font/woff2', crossOrigin:'anonymous' })` for the chosen font's latin file;
- `themeVersion`, `fontKey`, `logo {url,width,height,alt}` come from `ResolvedTenant.settings` (request to backend for logo width/height, needed for CLS and LCP);
- cascade order: `tokens.css` (platform) < `theme.css` (tenant). `theme.css` redefines **the same variables** for `:root`.

### 7.3 Dark mode without flash under strict CSP (no script, no cookie)
- **Auto** mode (default): `theme.css` emits light in `:root` and dark inside `@media (prefers-color-scheme: dark) { :root { ... } }`, with `color-scheme: light dark`. The browser applies dark before first paint: no script, no flash.
- **Tenant-forced** mode (FR-BRD-05): `theme.css` directly emits the values of the chosen mode in `:root` (no media query) and `color-scheme: light|dark`. The `data-theme` of ADR-0012/04b 14 is **not needed** on real pages, because the mode is inside the versioned file (changing it changes `themeVersion`). This avoids having to read the slug in the root layout to mark `<html>`.
- No user switch (UX does not foresee one): no `localStorage`, no theme cookie. If needed in future, it is a product decision + SEC (functional cookie in admin).
- `/system` and unbranded pages: `tokens.css` (auto light/dark).
- Verification: Playwright `colorScheme: 'dark'` and `'light'` on three palettes; assertion "first paint already dark" with a screenshot at `domcontentloaded`; `expectNoCspViolations`.

### 7.4 CSP compatibility (decision 5.1: `style-src 'self' 'nonce-…'`, no `style-src-attr`)
- In production Next emits CSS as external `<link>`s (no inline `<style>`); we do not use `next/font`, CSS-in-JS or `<style jsx>`.
- **Server-rendered HTML must contain no `style=` attributes.** DOM built by the client via CSSOM (`el.style.x = ...`, which React uses for the `style` prop after hydration) is *not* blocked by CSP; the attribute serialized in SSR HTML is. Therefore: (a) the JSX `style` prop is forbidden (eslint `react/forbid-dom-props` + Semgrep on the decision 5.1 rule); (b) dynamic values: enumerated classes (e.g. `col-start-1..31`, `span-1..31` for calendar bars, `Progress` width in 5% steps or a `<progress>` element), or `useCssVars(ref, vars)` (the only file allowed to call `style.setProperty`, only with validated values) executed after mount;
- **Audit of shadcn/Radix components** in M0: every copied component is rendered in a test and the SSR HTML is checked for `style=` (e.g. `Progress`, `ScrollArea`, `Select` positioning, `Tooltip`). Those that need it are either replaced (Progress -> `<progress>`) or rendered client-only after mount (Popper and Dialog are portals: mounted by the client, so fine).
- If, despite this, ABU-M5-05 shows unavoidable violations, the exception in 08 section 5.1 applies (`style-src-attr 'unsafe-inline'` and only that) and the rule "no value from user/tenant data" remains. Estimated risk: low.
- JSON-LD `<script type="application/ld+json">` is a data block: not executed, not subject to `script-src`.

### 7.5 Branding page (M5)
- `BrandingForm` (RHF): five `ColorField`s (validated hex + native `input type=color` + text field), `FontPicker` (RadioCard), logo (`LogoUpload` with mandatory alt), forced mode.
- `ContrastPanel` and light/dark previews: the unsaved draft must be evaluated with **the same function as the server**. To avoid shipping the algorithm in the bundle and importing `domain` from the UI, `previewContrast` (BRD-06) must also return the **derived values** for light and dark (request to backend); `ThemePreview` (client) applies the variables with `useCssVars` to a container with `data-theme-preview="light|dark"` (selectors `[data-theme-preview=dark] { color-scheme: dark }` in `globals.css`), debounced 250 ms, last response wins. Saving is still authoritative on the server (`updateBranding` recomputes with the same `deriveTheme`).
- Panel rows: icon + word (Pass, Warning, Blocked, Adjusted automatically), never colour alone; each fix is a button with new colour and ratio, reversible; reason for a block next to "Save changes".

### 7.6 Fonts
Three variable `woff2` families in `public/fonts/` (latin + latin-ext as two files with `unicode-range`), declared in `src/styles/fonts.css` with `font-display: swap`. All three `@font-face` rules live in the global CSS: the browser downloads **only** the one in use (`--font-family-selected` set by `theme.css`), as required by ADR-0012. Preload only the latin file of the chosen family (7.2). **Fallback with matched metrics** (`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override` on a local Arial `@font-face`) computed once offline and committed in `fonts.css` for each family: reduces swap CLS. Expected size per latin file: to be verified (budget <= 50 kB per family; `pyftsubset` subsetting in a script if needed).

---

## 8. Calendar

### 8.1 Data and views
`CalendarPage` (RSC) reads `?view=&date=&cancelled=`, calls `getCalendar` (BKG-13, range <= 42 days, visible only) and passes a `CalendarDto` (`vehicles`, `bookings`, `todayLocal`, `range`) to `CalendarView` (client). "Today" **comes from the server** (`todayLocal`, tenant time zone): the client does not know `Date.now()` (A-19).
- **Default view** when `view` is missing from the URL: the server picks *Day* if `Sec-CH-UA-Mobile: ?1` or mobile UA, otherwise *Grid*. A small `ViewPreferenceSync` (client, only when `view` is absent) compares with `localStorage` (per-device preference, UX W-D2) and `matchMedia('(min-width: 768px)')` and does `router.replace` if they diverge. Cost: a second render only for users whose preference differs from the default (FE-4 for localStorage).
- Period navigation (Prev/Today/Next/date): `router.push` in `startTransition`; the old grid stays, `aria-busy="true"`, the toolbar stays active. The active focus is restored by key (vehicleId + day) on the new props, inside a client wrapper that stays mounted.
- **Views**: *Grid* and *Week* (same component, 7 columns), *Month* (table with counts), *Day* (vehicle cards, phone default), *Agenda* (`<ul>` grouped by day with `<h3>`; **always rendered by RSC** without JS, reachable from the view switcher and from a "Skip to agenda" link before the grid).

### 8.2 Layout and sticky (only the grid scrolls horizontally)
- Scroll container **`<div data-calendar-grid="grid|week">`** (stable attribute requested by QA-2; `data-calendar-ready="true"` when mounted and scrolled to today, to avoid flakiness). It is the only element with `overflow: auto`; it has `max-height: calc(100dvh - var(--sticky-top) - toolbar)` so that the `position: sticky; top: 0` header works (a container with overflow-x makes sticky relative to the container itself). The **page** never scrolls horizontally (verified by `expectNoHorizontalPageScroll` with `allow: '[data-calendar-grid]'`).
- Fixed-width columns from tokens: `grid-template-columns: var(--calendar-name) repeat(var(--days), var(--calendar-day))` with `--days` chosen by a class (`cols-7|28|29|30|31|…`) generated in `calendar.css` (no inline). First column `position: sticky; inset-inline-start: 0` (108 px phone, wider on desktop) with the name wrapping on two lines, never truncated without the full name in `aria-label`.
- **Bars**: inside the cell of the first visible day, `position: absolute` with width from `span-1..31` classes (`calc(var(--calendar-day) * N)`); continuations beyond the window clipped. Shared day (return in the morning and pickup in the afternoon on the same vehicle, possible by the buffer/time rule): bars use `data-edge="end-half|start-half"` to take half a cell each. States: confirmed/active/completed/maintenance/cancelled with **icon + label + border/pattern** (04b 11), today column with tint + "Today" label + bold date.
- Density: cells >= 44 px effective width on touch (50 px token) and rows 56-58 px; `scroll-padding-inline-start` = sticky column width so focus is not covered (2.4.11).

### 8.3 Virtualization: not in v1
NFR-PERF-04: 50 vehicles x 31 days = 1,550 cells + bars: manageable DOM (~2,000 nodes). Optimisations: `content-visibility: auto` + `contain-intrinsic-size` on off-screen rows, lightweight empty cells (a childless `div`), no bar rendered for days outside the window. **Row virtualization breaks the ARIA grid** (needs `aria-rowcount/aria-rowindex`, roving tabindex on unmounted rows, text search, printing) and is not justified below ~100 vehicles. Review threshold: if the nightly NFR-PERF-04 measurement (<= 2 s client with 6x CPU) fails or `maxVehicles` exceeds 100, row windowing with `aria-rowcount` is introduced (the design is already compatible: `aria-rowindex` is always emitted). Decision recorded as assumption A-FE-3.

### 8.4 ARIA grid and keyboard (UX 9.3, NFR-A11Y-02)
- `role="grid"` named "Vehicle calendar, June 2026"; row `role="row"`; `role="rowheader"` (name, plate, state in text); header `role="columnheader"` with the full date ("Fri 12 Jun 2026, today"), `aria-current="date"` on today's header and cells; cells `role="gridcell"`.
- **Roving tabindex** in a generic hook `useRovingGrid({ rows, cols, onActivate, onPeriodChange })`: a single cell with `tabindex=0`, the others `-1`; Arrows, Home/End (first/last day of the row), PageUp/PageDown (previous/next period), Enter/Space activates, Esc closes the quick view and returns focus to the cell. No single-key shortcuts without a modifier (2.1.4). Period announcement (`role="status"`): "Showing 01 to 30 Jun 2026".
- **Booking = `button`** in the cell of the first visible day, with full accessible name ("Booking K7M2-9QXA, Fiat Panda, Rossi, 03 Jun 10:00 to 05 Jun 10:00, confirmed, unpaid"); continuations are `aria-hidden` and not focusable; covered cells expose `aria-description="Booked, K7M2-9QXA"`. Empty cells (admin only): name "Fiat Panda, Fri 12 Jun, free. Press Enter to create a booking."; operators: no action.
- **Quick view**: below 768 px a modal bottom `Sheet` (focus trap, Esc, focus returns to trigger); from 768 px a non-modal side panel `aside role="dialog" aria-modal="false"` with Esc. Data is already in the DTO (no fetch); "Mark paid" uses `PaymentSheet` and `setPayment` (optimistic, 5.3).
- **Month**: table of weeks (`th scope="col"` for days, each day a `button` "12 June, 4 pickups, 3 returns"). **Day**: list of cards (RSC + island for the quick view). **Agenda**: RSC list, no islands except opening the quick view.
- Scroll to today on load: `scrollIntoView({ inline: 'center', behavior: 'auto' })` (always instant, hence consistent with `prefers-reduced-motion`).

---

## 9. Responsive navigation

| Surface | < 768 | 768-1023 | >= 1024 |
|---|---|---|---|
| Public | top bar 60 (logo/title + "Contact"), no menu; sticky action bar only in the booking form | centered content | filters in a left panel on results |
| Admin | top app bar 56 (mark, title, avatar menu) + `BottomNav` 64 (Today, Calendar, Bookings, Vehicles, More only if there are overflow items) + FAB "New booking" (admin only; Today/Calendar/Bookings); on form routes the bottom nav and FAB disappear, the `StickyActionBar` remains | `SideNav` icon rail (label visible on focus/expansion), "New booking" button in top bar | `SideNav` sidebar 240 with groups Operations / Business / Settings, breadcrumb on deep pages |
| System | top bar with hamburger -> drawer (side `Sheet`) | hamburger or rail | sidebar |
| Auth | centered card, no nav | same | same |

Implementation: **a single `navItems(role)` function** (in `ui/layout`) produces the items; `BottomNav` (`md:hidden`, `nav aria-label="Admin bottom navigation"`) and `SideNav` (`hidden md:flex`, `nav aria-label="Main"`) consume it; both variants are in the DOM but the hidden one is `display:none` (out of the accessibility tree), no `useMediaQuery` hook for layout (no hydration mismatch). "More" = `Sheet` with overflow items (Customers, Revenue, Operators, Settings, Activity). Items not permitted for the role are **absent** (not disabled). `aria-current="page"` from pathname matching. Sticky heights as CSS variables (`--sticky-top`, `--sticky-bottom`) set by shell classes and used in `scroll-padding-*` (2.4.11). Low landscape (< 500 px height): header and bottom bar do not both stay sticky (`landscape-compact` class).

**Tables -> cards below 768**: `ResponsiveList` receives `columns` and `renderCard`; renders `<table>` (`hidden md:table`) and a `<ul>` of cards (`md:hidden`) with the same rows (max 25 per page). The row title is the link (stretched link), actions as siblings, never nested interactive elements. Sorting with buttons and `aria-sort`; pagination with page in URL.

**Filters**: bottom `Sheet` below `md` (with a live-count "Show N vehicles" button), panel/popover from `md`, inline bar from `lg` on admin lists. **Overlay forms** (payment, expense, cancel): sheet below `md`, centered dialog from `md`; short confirmations are always centered dialogs with focus on the safe action.

---

## 10. State components: error, empty, loading

All in `src/ui/states` (reuse mandatory; copy from the catalog, see UX 6.1 and 04b 13):

| Component | Use | Details |
|---|---|---|
| `Skeleton*` (`line`, `card`, `row`, `calendarRows`, `kpi`) | S-L | after 300 ms via CSS `animation-delay`; same size as the content; static under `prefers-reduced-motion`; container `aria-busy` + hidden text "Loading {thing}" |
| `EmptyState` (`variant: 'first-use' | 'filtered'`) | S-E / S-E2 | 64 px circle, 24 icon, H3, one line, **one** action (filtered: "Clear filters"); an empty section in Today = muted line without action |
| `ErrorState` | S-R | danger-soft circle + `triangle-alert`, reason, "Try again", reference (`digest`/`requestId`); never a stack |
| `SectionBoundary` | per-section errors | error boundary with compact `ErrorState`, the rest of the page lives on |
| `StatusBanner` / `BannerRegion` | S-RO, subscription, SMTP, legal | `role="status"`, max 2 visible ("2 more notices"), `role="alert"` only for blocking errors; the 04a 6.3 matrix implemented as the pure function `selectBanners(context, role)`, tested |
| `NotFoundState` / `ForbiddenState` | S-F | full page, same text for a missing id and another tenant's id |
| `SessionExpiredDialog`, `SessionTimeoutDialog` | S-T, WCAG 2.2.1 | see 14.2 |
| `ReadOnlyHint` | S-RO | `aria-disabled` control + visible reason text, still focusable |

Hidden/disabled rule (04a 6.1): permission (role) = absent; state or limit = visible, `aria-disabled`, reason in text. `Button` implements `aria-disabled` (not `disabled`) + blocked `onClick` when `reason` is present.

---

## 11. i18n

Languages: **`en` only** (decision F23); no selector, `lang="en"`. Structure ready for other languages without restructuring. Library: **`intl-messageformat`** (ICU; 03b assumption to confirm in M0, TD-3). No `next-intl`: there is no locale routing, and its weight/complexity is not needed (alternative evaluated and discarded; reconsider if a second language with locale URLs is added).

- **Catalog**: `src/i18n/messages/en/<namespace>.ts` (`as const` objects), aggregated in `src/i18n/messages/en.ts` (a single typed object as in 03b: the per-file split only serves the 300-line limit; clarification request FE-7). Namespace = first segment: `common`, `nav`, `errors`, `feedback`, `publicSite`, `booking`, `calendar`, `fleet`, `customers`, `finance`, `branding`, `settings`, `auth`, `system`, `a11y`, `email`, `pdf`. Keys `module.area.name` (camelCase segments) such as `booking.errors.conflict`, `errors.validation.required`, `feedback.payment.recorded`.
- **API**: `getTranslator(locale)` (server) and `useT()` (client) with compile-time checked keys (`MessageKey`) and parameters typed by the ICU parser in the verification script. The server resolves all RSC text; the client receives **only the namespaces needed** by the route group (`MessagesProvider namespaces=[...]` in the layout) so the whole catalog is not shipped. Messages without ICU do not invoke the formatter; `intl-messageformat` is loaded only in bundles that use parameters/plurals (form and admin pages), never in the public root (FE-D2).
- **Formats**: always from `shared/format` (reuse): `formatMoney(minor, currency)`, `formatDate`, `formatDateTime(tz)`, `formatDuration`, `formatList`; `en`, tenant time zone and currency explicit (04a 6.4). Booking codes `K7M2-9QXA` formatted with `formatBookingCode` in mono. The "Times are in {timeZone}" note beside date fields when the browser zone differs (needs `Intl.DateTimeFormat().resolvedOptions().timeZone` only client-side, after mount, never in server render).
- **Backend errors**: the `ActionResult` carries `messageKey` + `params` (and an already-resolved `message`); the UI uses the key with the client translator for consistency with fields; never concatenated text.
- **Lint against hardcoded strings** (blocking in CI, `lint-types-arch`): (1) `react/jsx-no-literals` with `noStrings: true` and `allowedStrings` for symbols only (`·`, `/`, `—`, `•`, `:`; NOT `€`: currency goes through `formatMoney`); (2) `no-restricted-syntax` on `JSXAttribute` `aria-label|aria-description|aria-placeholder|alt|title|placeholder|label` with `Literal` or `TemplateLiteral` value; (3) Semgrep rule for literal strings passed to `toast.*`, `setError`, user-facing `new Error`, `message:` in Zod schemas; (4) `scripts/check-messages.ts`: keys used but missing, keys present but unused, ICU parameters inconsistent with call sites, keys with spaces/wrong case, stub `it.ts` variants that fail to compile (type test). Exceptions: logs, internal exception messages, test names.
- **Pseudo-localization**: `PSEUDO_LOCALE=1` (only `APP_ENV=local|ci`) transforms the catalog (accents, +40% length, `[… ]` brackets); Playwright layout suite at 320/375 (overflow/truncation) as in 10-test-plan 9.6. No text inside images; CSS logical properties (`ms-*`, `ps-*`, `inset-inline-*`) by default; RTL not designed.
- **Tenant-written content** (title, description, notes, vehicle names, logo alt): shown as data; the rest of the UI is English.

---

## 12. Accessibility implementation checklist (WCAG 2.2 AA; source 04a section 9 and 04b section 15)

Every item is a Definition of Done criterion for a PR touching UI; "T" = automated test, "M" = manual check.

| # | Implementation | Test |
|---|---|---|
| 1 | `<html lang="en">`, landmarks `header/nav/main/footer`, a single `h1` per page (`PageTitle` with `tabIndex={-1}`), unique titles "{Page} · {Tenant title}", no skipped level | axe T, `jsx-a11y` rule |
| 2 | `SkipLink` as first focusable; the calendar adds "Skip calendar" and "Skip to agenda" | Playwright T |
| 3 | **Focus on every client navigation**: `RouteFocus` (client) moves focus to `h1[data-page-title]` on `pathname` change (not for search-params-only changes); Next's route announcer announces the title | Playwright T |
| 4 | Radix Dialog/Sheet/AlertDialog: focus trap, Esc, return to trigger, inert background; safe action with initial focus in destructive dialogs | component T + Playwright |
| 5 | After failed submit focus goes to the `ErrorSummary`; after deletion, to the next item or the list title; after confirmation loads, to the title | component T |
| 6 | Visible labels, accessible name = visible label (2.5.3), icon buttons with catalog `aria-label`, "Select" with the vehicle name, distinguishable (underlined) links | `jsx-a11y` + axe |
| 7 | Errors: `aria-invalid`, `aria-describedby`, icon + text; states with `role="status"`/`aria-live="polite"` (result counts, saves, availability, contrast, copy code); blocking errors `role="alert"` | component T |
| 8 | Targets 44x44 on touch (`--control-h`), never < 24x24 with spacing (2.5.8); row actions >= 32 on desktop | `expectTouchTargets` T (320/375/390) |
| 9 | No drag-only (2.5.7): photo reorder with buttons | M |
| 10 | No CAPTCHA/puzzles; correct `autocomplete` (`given-name`, `family-name`, `tel`, `email`, `username`, `current-password`, `new-password`), paste allowed, show/hide password | component T (typed attributes in `FormField` props) |
| 11 | Session timeout: dialog 2 minutes before, focus on "Stay signed in" (2.2.1) | Playwright with `page.clock` T |
| 12 | Colour never the only signal: statuses = icon + text (+ border/pattern in calendar); balance = word + sign; today = label + weight; validation = icon + text | axe + M |
| 13 | Reflow at 320 px and 200% zoom: no fixed-height containers on text, `overflow-wrap: anywhere` on email/codes/URLs; calendar is the only exception | `reflow-320` T |
| 14 | `prefers-reduced-motion`: global CSS zeroes animations/transitions, static skeletons, no scroll animation; spinner replaced by label | Playwright `reducedMotion: 'reduce'` T |
| 15 | Tooltips only for non-essential hints (1.4.13: dismissible with Esc, hoverable, persistent); disabled reasons always visible text | M |
| 16 | `forced-colors: active`: chips with border, focus with `outline`, calendar bars with outline (`forced-colors:` variants) | Playwright `forcedColors: 'active'` smoke |
| 17 | Images: vehicle card `alt=""` when the name is adjacent (UX 9.1.18 decision), gallery with meaningful alt, logo with tenant alt, decorative icons `aria-hidden`; see FE-6 for the conflict with SEO SR-15 | axe + M |
| 18 | 3 px focus ring + 2 px offset (`--ring`) on every focusable, never removed; `scroll-padding-*` equal to sticky heights (2.4.11) | Playwright: focus not covered by bottom nav/FAB/sticky bar |
| 19 | Calendar: ARIA grid + Agenda (section 8.4) | Playwright keyboard T + M (VoiceOver/NVDA) |
| 20 | Error/404/503 pages: titles and `h1` present, home link | axe T |

axe (`wcag2a, wcag2aa, wcag21aa, wcag22aa`) on every route class and every wireframe state, in light, dark and with three tenant palettes (10-test-plan 9.1): **zero serious/critical violations** as the gate; best-practice only reported. Manual verification: keyboard on every flow, VoiceOver iOS + NVDA/Firefox (public, calendar, booking edit), 320 zoom.

---

## 13. Performance: budget, images, loading

### 13.1 Budget (measured on simulated 4G, mobile, 30 vehicles; p75 approximated by the median of 5 runs, 10-test-plan section 10)

| Page | LCP | INP | CLS | TTFB | JS first-load (gzip) |
|---|---|---|---|---|---|
| `/{slug}` | <= 2.5 s (LCP element = H1 or logo) | <= 200 ms | <= 0.1 | <= 800 ms (SEO SR-14) | **<= 150 kB** (SR-14, NFR-PERF-01), target <= 125 |
| `/vehicles` | <= 2.5 s | <= 200 | <= 0.1 | <= 800 | **<= 170 kB** (proposal) |
| `/book`, `/booking/{code}` | <= 2.5 s | <= 200 | <= 0.1 | <= 800 | **<= 200 kB** (RHF + Zod + ICU), confirmation <= 150 |
| Admin (pages) | <= 3 s on Fast 3G CPU 4x | <= 200 | <= 0.1 | n/a | <= 250 kB, calendar <= 280 (proposal, thresholds to be revised after the first measurement) |

Month calendar 50x31: <= 2 s client-side with 6x CPU (NFR-PERF-04). The real size of the Next 15 (React 19) runtime is **to be measured in M0** on an empty app (spike S-FE-1): if it exceeds ~110 kB gzip, the 150 kB root budget leaves very little and must be renegotiated (FE-2).

### 13.2 How it is met
- Root without client components (FE-D2); `lucide-react` named imports; Radix only where needed; no libraries for trivial things (native `input type="date"` + `select` in 15-minute steps, as per SEO and UX; no moment/dayjs on the client, no lodash, no animation library: CSS transitions).
- Per-route code splitting (App Router); `next/dynamic` for heavy non-critical islands (`FiltersSheet` loaded on open, `QuickView`, `ContrastPanel`, `PaymentSheet`).
- **Deterministic PR gates**: `tests/e2e/perf/js-budget.spec.ts` loads pages in the compose stack, sums the *transferred* bytes of scripts (CDP `Network.loadingFinished.encodedDataLength`, compression on) and compares with the table; number of requests and absence of third-party hosts; `expectNoCspViolations`; DOM weight (nodes) on the calendar. **Nightly timing gates**: Lighthouse CI (`@lhci/cli`, 5 runs) with 10% tolerance (10-test-plan section 10).

### 13.3 Images
- Plain `<img>` (not `next/image`, see section 1): `src` 480 + `srcset="…-480.webp 480w, …-1280.webp 1280w"` + `sizes` per column, explicit `width`/`height` and 16:9 `aspect-ratio` with `object-fit: cover` (CLS), `decoding="async"`; the first two cards `loading="eager"` (the first `fetchpriority="high"` only if it is the LCP, which on `/vehicles` it may be), the others `lazy`. Placeholder: tinted gradient + `car` icon in CSS (no request).
- Logo: `<img>` with `width`/`height` from the DTO, `fetchpriority="high"` on the root (SEO SR-14), WebP <= 480 px wide.
- No hero image; no text in images; the OG image is produced by the backend.
- Variants produced by the backend are 480 and 1280 (06 10.3), while 04b section 17 mentions 480 and 960 and UX W-P2 a 4:3 ratio (04b section 17: 16:9): we follow **backend (480/1280)** and **16:9**, see FE-6.

### 13.4 Client-side upload and downscaling (4 MB limit, 12 MB from phones)
`ui/lib/downscale-image.ts`: `createImageBitmap(file, { imageOrientation: 'from-image' })` -> canvas with long side <= 2000 px -> `toBlob('image/jpeg', q)` (q=0.85, reduced in steps of 0.05 and then dimensions reduced until <= 3.5 MB); PNG with transparency (logo) stays PNG with long side <= 512 px; input `accept="image/jpeg,image/png,image/webp"` without `capture` (camera or gallery; iOS converts HEIC to JPEG); decode failure -> "Use a JPEG, PNG or WebP image." No dependency (avoids `browser-image-compression`, 03b dependency policy). `ui/lib/upload-blob.ts`: **XHR** (needed for `upload.onprogress`; `fetch` has none) with raw body (BE-D2), `X-Request-Id` read from the response, maps problem+json -> `ActionResult`-like. Sequential queue. CSP: `blob:` is needed only for the preview (`img-src blob:`, SR-HDR-02) and for export download (`URL.createObjectURL`).
Export download (POST, 06 7.1): `useFileDownload` -> `fetch` POST; if `!ok` it reads the problem+json and shows the error inline (`EXPORT_IN_PROGRESS`, `EXPORT_ROW_CAP_EXCEEDED`); if ok it writes the stream into a `Blob` and triggers `a[download]`; a native form would show a JSON page on error.

### 13.5 Browser-side HTTP caching
`/media/*` and `theme.css?v=` immutable (backend); HTML always `no-cache`/`no-store` (header matrix). Fonts `public/fonts/*` with `Cache-Control: public, max-age=31536000, immutable` and a content-hashed file name (the URL changes when the version changes). No service worker, no PWA in v1.

---

## 14. Authentication and client-side security

### 14.1 Session
Cookies `__Host-rc_tenant` / `__Host-rc_system` **HttpOnly**: the client never sees the token, there is no `localStorage`/Bearer. The client does not decide access: pages call `requireStaffPage`, actions call `Guard`. The only session information reaching the client is `{ role, displayName, idleExpiresInMs, mustChangePassword }` (DTO) in the shell provider. Public pages neither read nor set cookies (test: no `Set-Cookie`, SR-GDPR-02).

### 14.2 Expiry and resumption
- `SessionClock` (client, rendered by `AdminPage` on every navigation) receives `idleExpiresInMs` (30 min staff / 15 min system) and refreshes a **relative** timer (`setTimeout`, no `Date.now()`); every successful server action response renews the full `idle` timer (the server extends at most every 60 s).
- At `T-2 min`: `SessionTimeoutDialog` ("You'll be signed out in 2 minutes", focus on "Stay signed in", action `touchSession`). At expiry: `SessionExpiredDialog` (S-T) with in-place login form (`loginStaff`/`loginSystem`), form state in memory, **one** retry of the failed action after login. Multi-tab not synchronised in v1 (discovered at the first action; R-FE-5).
- `mustChangePassword` -> the shell shows only `account` and logout.
- Token pages (`activate`, `reset-password`): GET reads `peekCredentialLink` (used/expired/invalid with distinct messages, 06 X6); the client **removes the token from the address bar** with `history.replaceState` on mount and keeps it in memory for the POST (X5); `Referrer-Policy: no-referrer` from the central headers.
- `next=` after login: `safeNextPath()` accepts only relative paths under `/{slug}/admin` (or `/system`), no open redirect.

### 14.3 Bundle security
No secrets in the bundle (no `NEXT_PUBLIC_*` defined; the only config towards the client is the tenant provider DTO). CI check: grep of the build output for known variables and canaries (`INSECURE_DEV_`), `gitleaks`. No `eval`, no URL built from user input towards the outside; tenant external links (privacy/terms) only `https:` with `rel="noopener noreferrer"` and text "(opens in new tab)". Dependencies: 03b policy (licence allowlist, pinned versions, audit); new client-side candidates: `react-hook-form`, `@hookform/resolvers`, `intl-messageformat`, `sonner`, `lucide-react`, Radix (via shadcn) with `class-variance-authority`, `clsx`, `tailwind-merge`. No other library without justification in the PR.

---

## 15. Frontend observability, analytics, consent

- **Analytics / cookie consent**: none. FR-PUB-13 and NFR-GDPR-07 forbid non-essential cookies and third-party requests; no banner is needed and none should be added (adding one would imply tracking). Possible future analytics: product decision + SEC + privacy notice update.
- **Error tracking**: **no browser SDK** (SR-LOG-08, `12-osservabilita.md`: Sentry server-side only, no `@sentry/nextjs`). Server render errors: `onRequestError` (backend) records them; the UI shows `error.digest` as the reference (Next links it to the server log). Request to the observability-engineer: include `digest` in the `app.error.unhandled` event field so the reference the user sees can be searched (FE-9). Server action errors: `requestId` in the result, shown in `ErrorState`/banner with a "Copy reference" button. Upload and export errors: `x-request-id` from the response.
- **Known limit**: exceptions thrown only in the browser after hydration (event handlers) reach at most `error.tsx` but are not sent anywhere. A reporting endpoint would be an unauthenticated write (same reason why 08 SR-HDR-02 excludes the CSP report endpoint). Accepted in v1 (risk R-FE-6); alternative in FE-5.
- **RUM / Core Web Vitals**: no RUM in production v1 (it would need a beacon to an endpoint: same problem and FR-PUB-13). Lab measurement: Lighthouse CI + Playwright (10-test-plan 10). For field data, the Search Console Core Web Vitals report is used once there is traffic (SEO section 14).
- **Trace ID propagation**: the browser does not generate request IDs (the middleware creates them, 12 section 2). The client keeps and shows the `requestId` of results; `traceparent` is reserved for OTel (currently off): no frontend work now. The correlation test in `12-osservabilita.md` (x-request-id on action, handler and job) covers actions; for RSC pages the ID is in the response `x-request-id` header.
- **Test telemetry**: no test hook in the production bundle. QA-2: `data-calendar-grid` (and `data-calendar-ready`) are **permanent, harmless attributes**, present in production too; no other `data-testid` unless agreed (section 16.2).

---

## 16. Frontend test plan

### 16.1 Levels
| Level | Tool | What | Where |
|---|---|---|---|
| Unit functions/hooks | Vitest | `parseMoneyInput`, `selectBanners`, `error-presentation`, `useRovingGrid` (pure navigation logic), `safeNextPath`, `json-ld` (`<` escape), `downscale-image` (dimensions/quality with fake canvas), `applyActionResult`, `check-messages` | colocated `*.test.ts(x)` |
| Components | Vitest + Testing Library + `user-event` + `jest-dom` (+ `vitest-axe` as a fast safety net) | forms (on-blur validation, error summary with focus, `fieldErrors` mapping, pending, S-X conflict, `PRICE_CHANGED`), `FormField`, `EmptyState/ErrorState`, `BannerRegion`, `ResponsiveList`, `PhotoManager` with fake upload, `ContrastPanel` with fake responses, `SessionTimeoutDialog` with fake timers, **SSR render of every shadcn component with a "no `style=` in the HTML" test** | colocated |
| E2E | Playwright (projects of 10-test-plan 6.1) + `@axe-core/playwright` | flows of 6.2 with page objects; viewports 320/360/375/390/412/768/1024/1280; light/dark; three palettes; `reducedMotion`; `forcedColors`; CSP listener; no cookies on public pages; JS budget | `tests/e2e` |
| Visual | Playwright `toHaveScreenshot` | key pages x 3 palettes x light/dark, self-hosted fonts, baselines only via PR | nightly + M5 |
| Performance | Lighthouse CI + `js-budget.spec.ts` | section 13 | PR (JS) / nightly (timings) |
| Architecture | dependency-cruiser + ESLint boundaries | `ui` does not import `app/`, `infrastructure`, `platform`; `application` only `schemas`/`dto` | CI |

Rules: components tested with **fakes injected via props** (FE-D6), no `vi.mock` of modules; tests do not depend on jsdom CSS layout (geometry is verified in Playwright); test names in English; a UI bug starts with a red test.

### 16.2 Test selectors and attributes
Priority to roles/labels (also verifies accessibility). `data-testid` allowed only when there is no natural role, listed in `tests/e2e/pages/selectors.md`. Agreed stable attributes: **`data-calendar-grid`** on the calendar scroll container (value = view; used by `expectNoHorizontalPageScroll({ allow })`), **`data-calendar-ready`**, `data-page-title` on the H1; `data-density` is not needed (CSS). The attributes do not change with theme or language.

### 16.3 Page objects (`tests/e2e/pages/`, one per page, English methods, no assertions inside page objects except `expectLoaded()`)
`PublicSearchPage` (`fillDates`, `search`, `contactBlock`), `ResultsPage` (`openFilters`, `applyFilters`, `selectVehicle(name)`, `cards`), `BookingFormPage` (`fillCustomer`, `confirm`, `errorSummary`, `banner`), `ConfirmationPage` (`code`, `downloadPdf`), `TenantStatePage` (503/410/404 copy), `AdminLoginPage`, `SetPasswordPage`, `TodayPage`, `CalendarPage` (`switchView(view)`, `scroller()` = `[data-calendar-grid]`, `cell(vehicle, isoDate)`, `bookingButton(code)`, `pressKey`, `quickView`, `agenda`), `BookingsPage`, `BookingDetailPage` (`recordPayment`, `complete`, `cancel`), `BookingEditPage` (`changesPanel`, `save`, `conflictBanner`), `VehicleFormPage` (`addPhoto(path)`, `photoRow(n)`), `VehiclesPage`, `RevenuePage`, `BrandingPage` (`setColour`, `contrastRow(name)`, `preview(mode)`), `SettingsPage`, `SystemTenantsPage`, `CreateTenantPage`, `AdminNav` (`bottomNav`, `sideNav`, `openMore`). Shared helpers from 10-test-plan 6.3 (`expectNoHorizontalPageScroll`, `expectTouchTargets`, `runAxe`, `expectNoCspViolations`, `withTenantPalette`) and a `focusIsNotObscured(page)` (compares the active element's bounding box with the sticky bars; 2.4.11).

### 16.4 Clock and determinism (QA request)
- **No clock hook in the frontend.** "Today" and deadlines come from the server (FE-D9): the test server clock (`/api/test/clock`, `APP_ENV=ci` only, backend responsibility) and Playwright's `page.clock.install({ time })` for browser timers (session dialog, `fastForward`) are enough. The test "today highlight with browser in another time zone" (TC-CAL-03) works because the client does not use its own zone.
- Data: deterministic synthetic seeds (builders); animations disabled in tests with `reducedMotion: 'reduce'` (waits rely on roles/states, not timeouts).

### 16.5 Mapping to criteria
AC5 (calendar, natural order, views, today) -> `CalendarPage` + keyboard + Agenda; AC9/AC11 (theme/375/contrast) -> palettes x light/dark x 320..1280 + axe + overflow; AC3/AC4 (public) -> mobile flow; FR-UX-06 -> table 6.2 of 10-test-plan with the page objects above; NFR-A11Y-02 -> grid keyboard + Agenda + manual.

---

## 17. Estimate, risks, assumptions, requests, questions

### 17.1 Estimate (person-days, one senior frontend developer; includes component tests, E2E of own flows, axe; backend and devops excluded)
| Milestone | Frontend content | days |
|---|---|---|
| M0 | Next/Tailwind v4/shadcn scaffold, `build-tokens`, base `ui/form` + `ui/states` + `ui/layout`, i18n (catalog, `useT`, `check-messages`, lint), `useActionRunner`, Vitest+RTL and Playwright setup (base page objects, helpers, axe, JS budget), shadcn vs CSP audit, spikes S-FE-1/S-FE-2 | 8-10 |
| M1 | Auth (login, forgot, reset, activate, account, sessions), admin and system shell (responsive nav, banners, `SessionClock`), tenant console (list, creation, detail), tenant states | 12-15 |
| M2 | Public site (root + SEO/JSON-LD, results + filters, booking form, confirmation, legal, states), admin vehicles (list, detail, form, photos with downscale/upload), `theme.css`/font integration | 16-19 |
| M3 | Today, calendar (Grid/Week/Month/Day/Agenda, ARIA grid, quick view), bookings (list, detail, new/edit with Changes panel and live availability), customers, operators, activity | 20-25 |
| M4 | Expenses, revenue (overview/by vehicle/compare/snapshot history), CSV export with download | 8-10 |
| M5 | Branding (contrast, previews, font, logo), settings, responsive hardening (320..1280), axe sweep 3 palettes x light/dark, visual regression, pseudo-loc | 10-13 |
| M6 | GDPR UI (anonymise, export), performance polish, fixes from SEO/Lighthouse/DAST audits | 5-7 |
| **Total** | | **79-99 (about 16-20 weeks for one developer)** |

Parallelism: after M0 the work is almost entirely sequential with the backend of each milestone (development against the 06 contracts); the frontend can start with fake actions.

### 17.2 Risks
| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R-FE-1 | **HTTP 410/503 statuses cannot be produced from a Server Component** (SEO section 5): needs Node middleware or an alternative path; depends on the Next version and on the host (still to be decided) | High | Spike S-FE-2 in M0 (rewrite with `status` from Node-runtime middleware, or a dedicated route handler for non-ok states); fallback 200 + `noindex` documented and accepted by SEO. Question FE-1 |
| R-FE-2 | The 150 kB gzip root budget is too tight relative to the Next runtime | High | Root without client components, measurement in M0, threshold renegotiable with SEO; verified in CI |
| R-FE-3 | shadcn/Radix components that emit `style=` in SSR HTML break the strict CSP | Medium | Audit in M0, replacements (`<progress>`), exception only `style-src-attr` as in 08 section 5.1 |
| R-FE-4 | The "unsaved changes" guard does not cover every navigation (App Router has no route-change events) | Medium | Declared coverage: app links + tab close + back; dedicated test; limit documented |
| R-FE-5 | Multiple tabs: session expiry is discovered at the first action | Low | S-T with retry; `BroadcastChannel` deferred |
| R-FE-6 | Browser-only errors not reported (no SDK) | Medium | `digest` reference, E2E tests with console errors, periodic review; alternative FE-5 |
| R-FE-7 | Tailwind v4 / `@theme` + shadcn: compatibility and minimum browsers (Safari 16.4+, Chrome 111+; NFR-COMP-01 requires iOS 16+ and last 2 versions: ok, **iOS 16.0-16.3 excluded**) | Medium | Verification in M0; fallback Tailwind v3 with generated preset (FE-3) |
| R-FE-8 | Calendar slow on mid-range phones with many vehicles | Medium | Nightly NFR-PERF-04 measurement, `content-visibility`, windowing threshold (section 8.3), Day view default on phone |
| R-FE-9 | Wrong default view via UA/Client Hints (tablets) -> second render | Low | `ViewPreferenceSync` corrects it; no correctness impact |
| R-FE-10 | Retina photos on cards: `srcset` picks the 1280 variant (heavier) | Medium | Check weight in Lighthouse; request a 960 variant (FE-6) |

### 17.3 Assumptions (to be confirmed)
- **A-FE-1** Latest stable Next.js major and React 19 pinned in M0 (AS-5); Tailwind v4 CSS-first; Zod 4 (smaller client weight) or 3, to be decided in M0 with the bundle measurement.
- **A-FE-2** `intl-messageformat` as formatter (TD-3); catalog split into separate namespace files.
- **A-FE-3** Maximum reasonable fleet <= ~100 vehicles per tenant (`maxVehicles` plan) to defer virtualization.
- **A-FE-4** No user-selected light/dark theme; only device + tenant override.
- **A-FE-5** No charts in v1 (UX marks them "Could"); if needed, the table is the text alternative and a light SVG library is to be evaluated.
- **A-FE-6** Pickup and return date/time with native `input type="date"` + `select` in 15-minute steps (UX "Date picker"; SEO recommends it).
- **A-FE-7** Server actions can be called from client components passed as props (native Next support); tests use fakes.
- **A-FE-8** The backend provides in DTOs: `todayLocal`, `idleExpiresInMs`, `logo {url,width,height,alt}`, `themeVersion`, `fontKey`, `formToken` with idempotency key, derived values in `previewContrast`.

### 17.4 Requests to other documents and agents (not edits of their files)
| To | Request |
|---|---|
| solution-architect (03b) | (1) allow `ui -> application/schemas.ts` and `dto.ts` (only these) with a dependency-cruiser rule; (2) i18n catalog split into `messages/en/<namespace>.ts`; (3) `var(--x)` instead of `hsl(var(--x))` (hex tokens) and Tailwind v4 `@theme` instead of "preset"; (4) record the UI references in section 6 (`ui/form/form-shell.tsx`) |
| backend-developer (06) | DTOs listed in A-FE-8; `previewContrast` returns derived values; `previewBookingChange` outcomes usable as a preview; mechanism for 410/503 statuses (S-FE-2); `RATE_LIMITED.retryAfterSeconds` always present |
| seo-specialist (09) | Confirm the budget per page class (FE-2); alt text of photos on cards (FE-6); acceptance of the 200+noindex fallback for 503/410 if the spike fails |
| security-engineer (08) | Opinion on: localStorage for the view preference (FE-4); booking draft in memory only; `useCssVars` via CSSOM and the Semgrep rule on `style` |
| observability-engineer (12) | `digest` field in `app.error.unhandled` (FE-9) |
| qa-engineer (10) | Answer to QA-2: attribute `data-calendar-grid` (+ `data-calendar-ready`); QA-1: no clock hook on the frontend side (section 16.4); page object list of 16.3 |
| ui-designer (04b) | Confirm 16:9 vs 4:3 and 480/1280 variants; density via CSS media query instead of `data-density`; absence of `data-theme` on real pages |

### 17.5 Spikes planned in M0
- **S-FE-1** Empty App Router + `next build`: root gzip JS weight (runtime target <= ~110 kB) and nonce/CSP verification with `script-src 'strict-dynamic'`.
- **S-FE-2** HTTP status: try (a) `NextResponse.rewrite(url, { status })` from Node-runtime middleware, (b) a route handler rendering the state, (c) `notFound()` behaviour with/without `loading.tsx`; outcome -> FE-1.
- **S-FE-3** CSP audit of shadcn components (SSR HTML without `style=`), Tailwind v4 on Safari 16.4.

---

## 18. Questions (IDs FE-n)

The full question table is in the Esito returned with this document; the IDs are defined here.

| ID | Topic | Reference |
|---|---|---|
| FE-1 | How to obtain real 503/410 on public pages | R-FE-1, S-FE-2 |
| FE-2 | JS budget per page class | 13.1 |
| FE-3 | Tailwind v4 vs v3 + preset | 7.1 |
| FE-4 | Calendar view preference in `localStorage` | 3 (rule 7), 8.1 |
| FE-5 | Reporting browser-only errors | 15 |
| FE-6 | Images: 480/1280 variants, 16:9, alt on cards | 13.3 |
| FE-7 | Clarifications to 03b (ui->schemas, split catalog) | 3 (rule 4), 11 |
| FE-8 | Public booking draft in memory only | 6 |
| FE-9 | `digest` in server logs | 15 |

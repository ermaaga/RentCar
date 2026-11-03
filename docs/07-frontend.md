# Frontend: RentCar

Versione 1.0 · 2026-11-01 · Owner: frontend-developer · Fase 4, onda B (ultimo documento di analisi) · Stato: analisi, nessun codice
Input: `docs/03b-struttura-codice.md` (vincolante), ADR-0001/0012/0014/0015, `docs/04a-ux.md`, `docs/04b-ui-design.md` (direzione Clear + 3 prestiti), `docs/design/tokens.json`, `docs/design/clear/*.html`, `docs/06-backend-api.md`, `docs/08-security.md` (SR-HDR, SR-SES, decisioni 5.1/5.4), `docs/09-seo.md`, `docs/10-test-plan.md`, `docs/02-requisiti.md` v1.3/1.4, `docs/12-osservabilita.md`.
Regola linguistica: documento in italiano; identificatori, chiavi, nomi di file e di test in inglese. I percorsi sotto `src/` sono **pianificati** (progetto greenfield, 03b TD-1); il primo task che crea un pattern lo posiziona esattamente dove indicato.

---

## 0. Decisioni di sintesi

| ID | Decisione | Perche (discriminante) |
|---|---|---|
| FE-D1 | **Tutto dinamico, nessuna ISR/SSG/Data Cache sulle pagine tenant.** Server Components di default; JS client solo in "isole" interattive. | ADR-0014 (sospensione effettiva alla richiesta successiva), CSP con nonce per richiesta (impone rendering dinamico), SEO SR-02 |
| FE-D2 | **La pagina root pubblica `/{slug}` non ha componenti client propri**: form di ricerca nativo `<form method="get">`, contatti come ancora `#contact`, nessun dialog. Il JS e solo il runtime del framework. | Budget 150 kB gzip (SR-14/NFR-PERF-01): il runtime App Router occupa gia la gran parte (da misurare in M0, spike S-FE-1) |
| FE-D3 | **Nessuna libreria di server state (TanStack Query/SWR) in v1.** Letture = RSC; URL = stato di vista/filtri; mutazioni = server action + `router.refresh()` in transizione. Letture "live" da client (anteprima contrasto, slug, suggerimenti cliente, anteprima modifica prenotazione) = server action `read` con un hook minimo `useActionQuery`. | Una cache client in piu = invalidazioni da mantenere coerenti con RLS/ruoli/sospensione; ~13 kB risparmiati; i requisiti non chiedono cache client |
| FE-D4 | **Form: react-hook-form + `zodResolver` con gli stessi schemi Zod di `application/schemas.ts`** (messaggi = chiavi di catalogo), un solo pattern (`FormShell`). Eccezione unica: il form di ricerca della root (GET nativo). | Sezione 6 (alternative valutate) |
| FE-D5 | **Tailwind CSS v4 (CSS-first) + shadcn/ui + Lucide; token generati da `tokens.json`** in `tokens.css` e `@theme`; il tema tenant sovrascrive le stesse variabili via `/{slug}/theme.css`. **Nessun `data-theme` e nessuno script per il tema**: modalita forzata dal tenant e emessa dentro `theme.css`. | CSP stretta, nessun flash, nessun cookie/storage (sezione 7) |
| FE-D6 | **Azioni iniettate come props** dalle pagine (`app/`) nei componenti di `modules/*/ui`: la UI non importa mai `app/actions`. | 03b livelli: `ui` non puo importare `app/`; DI per props/Context |
| FE-D7 | **Calendario senza virtualizzazione in v1** (<= ~60 veicoli x 31 giorni), `content-visibility: auto` sulle righe; ARIA grid con roving tabindex; Agenda come lista reale. | Sezione 8 |
| FE-D8 | **Nessuno stile inline**: vietato il prop `style` in JSX (lint + Semgrep); valori dinamici = classi enumerate o variabili CSS impostate via CSSOM da un unico hook. Obiettivo: `style-src` senza `style-src-attr` (decisione 5.1). | Sezione 7.4 |
| FE-D9 | **Il client non legge mai l'orologio per mostrare "oggi" o scadenze**: tutto arriva dal server come stringhe/durate (`todayLocal`, `idleExpiresInMs`). | Test deterministici con il clock CI (sezione 16.4) |
| FE-D10 | **Nessun analytics, nessun RUM, nessun SDK browser, nessun banner cookie** in v1. Core Web Vitals misurati in laboratorio (Lighthouse CI + Playwright). | FR-PUB-13, SR-GDPR-02, SR-LOG-08, `12-osservabilita.md` |

---

## 1. Strategia di rendering per gruppo di rotte

Next.js App Router, runtime Node. Tutte le pagine leggono headers/nonce per richiesta: sono dinamiche per costruzione. Non si usa `export const revalidate`, `unstable_cache`, `fetch` con cache, `generateStaticParams` per tenant, PPR. `next.config`: `poweredByHeader: false`, `output: 'standalone'`, `experimental.staleTimes.dynamic = 0`, `images.unoptimized = true` (le varianti WebP sono prodotte dalla pipeline `sharp`, ADR-0009: nessun endpoint `/_next/image`), `experimental.optimizePackageImports: ['lucide-react']`, `serverActions` come da 06 (backend li configura).

| Gruppo | Rotte | Strategia | Indicizzazione | Perche |
|---|---|---|---|---|
| Pubblico | `/{slug}` | **SSR dinamico, streaming minimo**: tutto il contenuto SEO (title, description, canonical, H1, contatti, form) e nell'HTML iniziale; zero client component propri (FE-D2) | `index, follow` solo se `PUBLIC_INDEXING_ENABLED=true` e tenant attivo/grace | SEO SR-02; TTFB p75 <= 800 ms |
| Pubblico | `/{slug}/vehicles`, `/book`, `/booking/{code}` | **SSR dinamico** con `loading.tsx`; isole client: sheet filtri, form prenotazione | `noindex` (meta + header) | Dati personali/parametrici, no-store sulla conferma |
| Pubblico | `/{slug}/privacy`, `/terms` | SSR dinamico, testo tenant **solo testo semplice escapato** (decisione 5.4) | `noindex` | XSS su origin condivisa |
| Pubblico (asset) | `/{slug}/theme.css`, `/media/*`, `*/pdf` | Route handler (backend): immutable/versionati | nessuna direttiva | ADR-0012/0009 |
| Admin tenant | `/{slug}/admin/**` | **SSR dinamico + isole client** (shell, form, calendario, sheet). Nessuna SPA: ogni pagina e un RSC che chiama il service | `X-Robots-Tag: noindex` (centrale) | Area riservata, SEO irrilevante, ma SSR evita waterfall e porta i dati gia filtrati per ruolo |
| Auth | `/{slug}/admin/login`, `forgot-password`, `reset-password`, `activate`; `/system/login`... | SSR dinamico, form client minimale; `Referrer-Policy: no-referrer` (header centrale) | noindex | Pagine token: `peekCredentialLink` in GET (sola lettura), POST dell'azione (06 X5) |
| System | `/system/**` | SSR dinamico + isole, tema piattaforma (nessun `theme.css`) | noindex | FR-UX-13 |
| Stati tenant | non attivo | Il layout `[slug]` risolve lo stato **prima** di qualsiasi Suspense (cosi lo status HTTP e ancora modificabile). 404 = `notFound()`. **410 e 503 non sono esprimibili da un RSC**: vedi rischio R-FE-1 e spike S-FE-2 | `noindex, nofollow` | 09-seo sez. 5 |

Regola di ordinamento (per far valere gli status): `layout.tsx` di `[slug]` fa `await resolveTenant()` e decide `notFound()`/pagina di stato; **nessun `loading.tsx` e nessun `<Suspense>` sopra o dentro il layout prima di quella decisione**. `loading.tsx` esiste solo ai livelli `page` (segmento figlio) e non avvolge il layout.

---

## 2. Albero delle rotte, layout e confini

Segue 03b (`(public)/[slug]`, `(tenant)/[slug]/admin`, `(system)/system`). Un solo `app/layout.tsx` radice con `<html lang="en">`; `/system` e `/media` sono segmenti statici che vincono su `[slug]`; gli slug riservati (ADR-0012) coprono il resto.

```
src/app/
  layout.tsx                  html lang=en, body, tokens.css + globals.css, SkipLink, ToastRegion, MessagesProvider(common)
  not-found.tsx               404 generica (url sconosciuti), noindex
  global-error.tsx            ultimo paracadute (client), riferimento = digest
  (public)/[slug]/
    layout.tsx                resolveTenant -> stato; <TenantTheme> (link theme.css + preload font); PublicShell (header 60, footer); BookingDraftProvider (solo memoria)
    page.tsx                  W-P1 Search + contatti + JSON-LD   [no client component]
    vehicles/{page,loading,error}.tsx      W-P2 (+ FiltersSheet client)
    book/{page,loading,error}.tsx          W-P3
    booking/[code]/{page,loading}.tsx, not-found.tsx   W-P4 (no-store, noindex)
    privacy/page.tsx, terms/page.tsx       testo semplice | link esterno
    theme.css/route.ts, booking/[code]/pdf/route.ts    (backend, 06 7.1)
    not-found.tsx, error.tsx               W-P5, S-R
  (tenant)/[slug]/admin/
    layout.tsx                resolveTenant, shell di cornice (NavShell, BannerRegion, SessionClock); NON fa auth da solo
    (auth)/login|forgot-password|reset-password|activate/page.tsx     senza nav, card centrata
    (app)/page.tsx            W-D1 Today                (loading.tsx, error.tsx)
    (app)/calendar/page.tsx   W-D2                      (loading.tsx, error.tsx)
    (app)/bookings/{page,new/page,[code]/page,[code]/edit/page}.tsx   (loading, error, not-found)
    (app)/vehicles/{page,new,[id],[id]/edit,[id]/expenses}/...
    (app)/customers|operators|revenue(+compare)|settings(+branding,booking-rules,legal,contact,email)|activity|account/...
    exports/*, vehicles/[vehicleId]/photos, settings/logo      route handler (backend)
  (system)/system/
    layout.tsx                shell piattaforma (drawer su phone, sidebar da lg)
    login|forgot-password|reset-password, tenants (+new, [slug]), activity, account
  api/, media/, exports/, robots.txt/   (backend)
  actions/<module>/*.ts       server action (backend; la UI non le importa)
```

**Confini per segmento**
- `loading.tsx`: scheletro con le **stesse dimensioni** del contenuto finale (CLS), mostrato dopo 300 ms (`token motion.duration.skeletonDelay`, CSS `animation-delay`, nessun JS), `aria-busy="true"` e testo nascosto "Loading {thing}". Presente su ogni pagina con query (tutte tranne root, auth, legal).
- `error.tsx` (client) per gruppo e per le pagine con dati: `ErrorState` (icona, motivo, "Try again" = `reset()`, riferimento = `error.digest`). Gli errori di sezione (es. un pannello Today) usano **`<SectionBoundary>`** (error boundary di React nel componente `ui`) cosi il resto della pagina resta utilizzabile (04b sez. 13).
- `not-found.tsx` per gruppo: stessa pagina per id inesistente e id di un altro tenant (S-F); link "Back to ..." alla home del gruppo.
- `global-error.tsx`: HTML minimo senza dipendenze dal tema (tokens.css di piattaforma).
- **Auth per pagina, non per layout**: i layout Next non si rieseguono ad ogni navigazione client. Ogni `page.tsx` admin/system inizia con `const actor = await requireStaffPage({ scope, minRole })` (wrapper in `platform/http`, chiama `Guard`; redirect a login con `?next=` validato da `safeNextPath()`, solo percorsi `/{slug}/admin/...`). Il test architetturale del route registry (06 3.2) copre anche le pagine. Il layout usa il ruolo solo per scegliere le voci di nav (il ruolo non cambia dentro una sessione).
- **Banner e `SessionClock` stanno in un wrapper `AdminPage` renderizzato da ogni pagina** (non nel layout), cosi si rivalutano ad ogni navigazione (stato abbonamento, conto alla rovescia di sessione).
- Titolo della top bar su phone: `TopBarTitle` (client) legge `usePathname()` e una mappa statica rotta -> chiave di catalogo; l'H1 reale e della pagina.

**Metadata**: ogni pagina esporta `generateMetadata` (title "{Page} · {Tenant title}", robots, canonical). Il layout `[slug]` imposta il default `robots: { index: false, follow: false }`; solo `/{slug}` lo sovrascrive (e solo se `PUBLIC_INDEXING_ENABLED`). `metadataBase = APP_BASE_URL` (via config iniettata). L'header `X-Robots-Tag` e centrale (middleware/header class), le meta sono cintura e bretelle. JSON-LD `AutoRental` solo in root, tramite `<JsonLd data>` (serializza con `<` -> `<`; valori solo da campi validati). Nessun `sitemap.xml` (SEO SR-08).

---

## 3. Regole server vs client

1. **Default = Server Component.** `'use client'` solo per: stato locale interattivo, handler, browser API (File/Canvas/matchMedia/IntersectionObserver), form RHF, Radix con stato (Dialog, Sheet, Select, DropdownMenu, Tabs).
2. **Il confine client passa dalle foglie**: pagina RSC -> componente `ui` presentazionale (RSC) -> isola client piccola. Mai `'use client'` su una pagina o su un layout intero (eccezioni: `error.tsx`, `global-error.tsx`).
3. **Dati ai componenti client solo come DTO serializzabili** (06 3.6: stringhe ISO, importi in minor unit, niente ID di altri tenant, niente hash). Niente `tenantId` nei prop. Date gia in stringa locale tenant (`startLocal`) + ISO UTC dove serve confrontare.
4. **Mai importare da client** `platform/*`, `infrastructure/*`, `application/*` (tranne `schemas.ts` e tipi DTO: richiesta di precisazione a 03b, FE-7), `composition/`. `modules/<m>/ui` importa: DTO/tipi e schemi dell'`application` del proprio modulo, `shared/`, `src/ui`, `src/i18n`. Regola dependency-cruiser dedicata: `ui -> application` ammesso solo per `schemas.ts` e `dto.ts`, e quei due file non possono importare nulla fuori da `shared/`.
5. **Azioni come props (FE-D6).** Esempio: `app/(tenant)/[slug]/admin/(app)/vehicles/new/page.tsx` importa `createVehicle` da `app/actions/fleet/create-vehicle` e rende `<VehicleForm action={createVehicle} />`; `VehicleForm` (client, in `modules/fleet/ui`) riceve `action: (input: CreateVehicleInput) => Promise<ActionResult<VehicleDto>>`. I test passano un fake. Per letture profonde (anteprima, suggerimenti) si usa un Context di feature (`BookingFormServicesContext`) valorizzato dalla pagina.
6. **Contesto tenant per la UI**: `TenantUiProvider` (client, in `src/ui/tenant`) espone `{ basePath, title, timeZone, currency, countryCode }` e `useTenantUrl()`. Tutti i link passano da `tenantUrl()` (ADR-0012); lint: vietati template literal `href={`/${...}`}`.
7. **Nessun `window.localStorage`/`sessionStorage`/cookie** nelle pagine pubbliche e per dati personali (SR-HDR-03). Unica eccezione proposta: preferenza vista calendario (non sensibile), vedi FE-4.
8. **Niente `dangerouslySetInnerHTML`, `v-html`, `innerHTML`** (Semgrep). Testo tenant sempre come figlio JSX (escape automatico), `white-space: pre-line` per i ritorni a capo. Unica eccezione: `JsonLd` (script `application/ld+json`, serializzatore dedicato e testato).
9. **Nessuna chiamata all'orologio** (`Date.now`, `new Date()`, `performance.timeOrigin` per logica di prodotto): regola ESLint gia in 03b (esteso al codice client). Countdown = `setTimeout/setInterval` su durate relative ricevute dal server.
10. **Hydration-safety**: formattazione di date/importi sempre con timezone e valuta del tenant espliciti (`shared/format`, riuso, non ricreare): nessun `toLocaleString()` senza argomenti (lint `no-restricted-syntax`). Niente `typeof window` nel render.

---

## 4. Struttura del codice frontend (dentro il layout di 03b)

```
src/ui/                          design system condiviso (riuso, un file per componente)
  components/ui/                 shadcn copiati e adattati ai token (button, input, dialog, sheet, tabs, ...)
  form/                          FormShell, FormField, ErrorSummary, StickyActionBar, useZodForm, applyActionResult
  states/                        EmptyState, ErrorState, SectionBoundary, Skeleton*, StatusBanner, BannerRegion
  layout/                        PublicShell, AdminShell, NavShell, BottomNav, SideNav, Sidebar, PageTitle, AdminPage
  data/                          DataTable + ResponsiveList (tabella md+, card <md), Pagination, FilterBar, useUrlFilters
  tenant/                        TenantUiProvider, TenantTheme (server), useTenantUrl
  session/                       SessionClock, SessionTimeoutDialog, SessionExpiredDialog, useActionRunner
  calendar/                      CalendarGrid, CalendarBar, useRovingGrid (generico: riusabile da altre griglie)
  hooks/                         useActionQuery, useCssVars, useFileDownload, useUnsavedChangesGuard, useMediaQuery (solo per comportamenti, mai per layout)
  lib/                           downscale-image.ts, upload-blob.ts, safe-next-path.ts, json-ld.ts
src/i18n/                        messages/en/<namespace>.ts (aggregati in en.ts), index.ts (getTranslator, useT), pseudo.ts
src/styles/                      tokens.css (generato), theme.generated.css (@theme, generato), globals.css, fonts.css, calendar.css
src/modules/<m>/ui/              componenti di feature (es. booking/ui: AvailabilityResults, BookingForm, BookingEditForm, ChangesPanel, QuickView, CalendarPage...)
```

Modulo -> componenti principali (riuso prima di creare: `ui` condiviso solo alla 3a duplicazione, regola del 3 di 03b):

| Modulo | `ui/` (feature) | Note |
|---|---|---|
| `booking` | `SearchForm` (server), `ResultsList`, `FiltersSheet`, `PublicBookingForm`, `ConfirmationPanel`, `TodayView`, `CalendarView` (+ `DayView`, `MonthView`, `AgendaList`, `GridView`), `QuickView`, `BookingsTable`, `BookingDetail`, `BookingEditForm`, `ChangesPanel`, `PaymentSheet`, `StatusActionsMenu`, `use-availability-search.ts` (reference hook 03b) | `StatusChip`/`PaymentChip` in `src/ui` (usati da 3+ moduli) |
| `fleet` | `VehicleCard`, `VehicleForm` (reference 03b), `PhotoManager`, `VehicleTable`, `MaintenanceToggle` | upload via `uploadBlob` condiviso |
| `branding` | `BrandingForm`, `ContrastPanel`, `ThemePreview`, `ColorField`, `FontPicker` (RadioCard), `LogoUpload` | anteprima: sezione 7.5 |
| `auth` | `LoginForm`, `ForgotPasswordForm`, `SetPasswordForm`, `AccountPage`, `SessionsList`, `OperatorsTable`, `OperatorForm` | stesso `FormShell` |
| `tenancy` | `TenantsTable`, `CreateTenantForm`, `TenantDetailSections`, `SettingsForms` | system + admin |
| `finance` | `RevenueOverview`, `MonthlyTable`, `CompareYears`, `ExpensesList`, `ExpenseSheet`, `SnapshotHistory` | niente grafici in v1 |
| `customers`, `audit`, `notifications`, `subscriptions` | tabelle/dettagli; banner abbonamento in `subscriptions/ui/SubscriptionBanners` | |

**Pattern di riferimento** (da registrare nella tabella di 03b sez. 6 nello stesso commit): componente server `modules/fleet/ui/vehicle-card.tsx`; form client `modules/fleet/ui/vehicle-form.tsx` (gia previsto); hook `modules/booking/ui/use-availability-search.ts` (gia previsto); `ui/form/form-shell.tsx` come riferimento per tutti i form.

---

## 5. Dati, cache e mutazioni

### 5.1 Letture
- Una pagina RSC chiama direttamente la query del service (06 7.3), dopo `requireStaffPage`/`resolveTenant`. Nessun `fetch` interno, nessun BFF. Query in parallelo con `Promise.all` quando indipendenti; sezioni lente dietro `<Suspense>` con `ErrorBoundary` di sezione (es. Today: contatori subito, "needs attention" in streaming).
- **Cache**: solo `React.cache` per richiesta (tenant, sessione, config; ADR-0014). Nessuna `Data Cache`, nessuna ISR. Router cache client con `staleTimes.dynamic = 0`: ogni navigazione ricarica.
- **Stato in URL** (06/UX): vista e data del calendario, filtri/ordinamento/pagina delle liste, query di ricerca pubblica. Parsing con gli schemi Zod `pageParams`/specifici (`parseSearchParams(schema, searchParams)` in `ui/data`); parametri non validi: root pubblica mostra il form con errore (UX 4.1), admin ripiega sui default. `useUrlFilters(schema)` aggiorna l'URL con `router.replace` dentro `startTransition` (il vecchio elenco resta visibile con `aria-busy`, ricerca testuale con debounce 300 ms).
- **Letture da client (`useActionQuery`)**: per `previewContrast`, `checkSlugAvailability`, `suggestCustomers`, `previewBookingChange`, disponibilita live nel form admin. Hook: debounce, **ultima richiesta vince** (token di sequenza, nessun `AbortController` perche le server action non lo supportano), stato `idle | loading | ok | error`, risultato tipizzato `ActionResult`, regione `role="status"` per l'esito. ~60 righe, nessuna dipendenza.

### 5.2 Mutazioni
Wrapper unico `useActionRunner()` (in `ui/session`): `run(action, input) -> ActionResult` dentro `useTransition`, con:
1. `isPending` per pulsante ("Saving…", larghezza invariata, `aria-disabled`, mai disabilitato solo perche invalido);
2. gestione eccezioni di rete (la server action lancia): converte in esito `{ ok:false, code:'NETWORK' }` -> S-O "You seem to be offline. Your changes are still here." con Retry, dati mantenuti;
3. `UNAUTHENTICATED` -> `SessionExpiredDialog` (S-T): login in-place, poi **un solo** retry del thunk memorizzato, stato form in memoria;
4. `TENANT_READ_ONLY`/`TENANT_UNAVAILABLE` -> banner e controlli `aria-disabled` con motivo; `MUST_CHANGE_PASSWORD` -> redirect a `account`;
5. `ok` -> `router.refresh()` nella stessa transizione (ricarica gli RSC senza perdere stato client) e/o `router.push` dove la UX lo prevede; toast **solo di successo** (Sonner, testo da `feedback.*`), mai l'unico canale per gli errori.

**Tabella codice errore -> trattamento UI** (`ui/states/error-presentation.ts`, riuso della `messageKey` che arriva nel risultato; qui solo il *trattamento*):

| Codici | Trattamento |
|---|---|
| `VALIDATION_FAILED` + `fieldErrors` | `setError` per campo, `ErrorSummary` con focus (UX 8.1.3) |
| `BOOKING_CONFLICT`, `VEHICLE_TAKEN`, `VEHICLE_IN_MAINTENANCE`, `PLATE_TAKEN`, `PLAN_LIMIT_REACHED` | banner S-X in cima al form (`role="alert"`), dati mantenuti, link alla prenotazione in conflitto (solo staff), scroll alla sezione |
| `PRICE_CHANGED` | banner warning, nuovo totale nel pulsante ("Confirm at €135.00"), focus sul banner (UX W-P3) |
| `BOOKING_STALE`, `STALE_RECORD` | banner "changed by someone else" + "Reload latest" che ricarica i dati **senza** perdere le modifiche dell'utente (mostrate nel pannello Changes) |
| `IMPACT_CONFIRMATION_REQUIRED` | apre `AlertDialog` con gli impatti (`params.impacts`), conferma riesegue con `acknowledgeImpact: true` |
| `RATE_LIMITED` | messaggio inline + `retryAfterSeconds` (testo, senza countdown animato) |
| `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE` | messaggio generico + `requestId` come riferimento, form intatto, Retry |
| `CONTRAST_TOO_LOW`, `LOGO_ALT_REQUIRED` | vicino al pulsante Save (non solo nel pannello), UX/UI 4.3 |
| `UPLOAD_*` | sulla riga della foto con messaggio dal catalogo |

### 5.3 Ottimistico vs pending
Solo dove l'operazione e idempotente, senza conflitti plausibili e con rollback banale: **`setPayment`** (chip "Paid" + saldo, `useOptimistic`, rollback con messaggio se errore), **`setCoverPhoto`/`reorderPhotos`** (Move earlier/later), **toggle email** nelle impostazioni. **Mai ottimistico**: creazione/modifica prenotazione, cambio stato, manutenzione (ha dialog di impatto), spese (toccano snapshot), tutto cio che l'autorita del server puo rifiutare per regole di business. Per tutto il resto: pending UI (spinner + label) e aggiornamento solo a risposta.

---

## 6. Architettura dei form

**Alternative valutate**

| | A. RHF + zodResolver + schemi condivisi (raccomandata) | B. `<form action>` nativo + `useActionState`, validazione solo server | C. TanStack Form |
|---|---|---|---|
| Validazione on-blur e riepilogo errori (UX 8.1) | si, nativa (`mode: 'onTouched'`, `reValidateMode: 'onChange'`) | richiede codice custom per blur/riepilogo | si |
| Riuso schemi del backend | si, gli stessi Zod di `application/schemas.ts` (messaggi = chiavi) | non serve | adattatore Zod |
| Form dinamici (disponibilita live, cliente nuovo/esistente, sezioni) | ottimo (`useWatch`, `useFieldArray`) | scomodo | ottimo |
| Peso client | ~9 kB RHF + ~1 kB resolver (+ zod ~13 kB, condiviso con ogni form) | 0 | ~12 kB |
| Progressive enhancement senza JS | no (azioni chiamate con oggetti, non FormData) | si | no |
| Maturita/ecosistema shadcn (`Form` di shadcn usa RHF) | alta | media | bassa |

Scelta **A**: i form admin sono complessi e il progressive enhancement non e un requisito. La **root pubblica resta GET nativo** (FE-D2): non porta RHF/Zod nel bundle del percorso critico SEO. Per coerenza (un solo modo di fare form) anche login, set-password, impostazioni usano A.

**Componenti** (`src/ui/form`)
- `useZodForm(schema, { defaultValues })`: `useForm` + `zodResolver`, `mode: 'onTouched'`. Gli schemi sono **factory senza testo**: gli errori sono chiavi (`errors.validation.required` con `params`), `FormField` traduce con `useT()`.
- `FormShell`: `<form noValidate>` con `onSubmit` -> `useActionRunner`, **ErrorSummary** (`role="alert"`, riceve il focus al submit fallito, link ai campi), banner di form (S-X), `StickyActionBar` (Cancel a sinistra, Save a destra, `position: sticky; bottom: 0` **in coda al form** e non `fixed`, per la tastiera iOS; `scroll-padding-bottom` = `size.sticky-bar`).
- `FormField`: label visibile, `aria-describedby` (help + errore), `aria-invalid`, icona + testo per l'errore, "(optional)" testuale, `autocomplete`/`inputmode` obbligatori nelle props (tipizzati), importi con `inputmode="decimal"` e parser `parseMoneyInput` (-> minor units, 2 decimali, mai `type=number`).
- `applyActionResult(form, result)`: mappa `fieldErrors[].field` (path con punti) su `setError`, imposta errore di form, restituisce il trattamento da `error-presentation`.
- `useUnsavedChangesGuard(isDirty)`: `beforeunload` per chiusura tab; per la navigazione interna un contesto `NavigationGuard` consultato da `AppLink` (link della shell e Cancel) e dal back (sentinella `history`); App Router non espone eventi di route change, quindi la copertura e "link dell'app + chiusura tab + tasto indietro"; il resto (URL digitato) e fuori portata. Rischio R-FE-4.
- **Idempotenza**: la chiave arriva dal server (la pagina la genera con `IdGenerator`, la passa come prop; per il form pubblico e dentro `formToken` di `prepareBooking`). Il client non genera ID (regola 5 di 03b).
- **Honeypot** pubblico: campo `website` fuori schermo (`position:absolute; inset-inline-start:-9999px` come classe), `tabIndex={-1}`, `aria-hidden`, `autocomplete="off"`; mai visibile ai lettori di schermo.
- **Bozza prenotazione pubblica**: `BookingDraftProvider` (stato React nel layout `[slug]`) sopravvive alle navigazioni client (back ai risultati, conflitto), si perde al reload. **Non** `sessionStorage`: contiene nome e telefono (SR-HDR-03). Deviazione dal wireframe UX (che prevede sessionStorage), motivata dalla sicurezza; FE-8 per conferma.
- **Anti doppio invio**: pending state + chiave idempotente lato server (FR-BKG-11).
- **Avvisi sulle note**: componente `NotesField` con avviso persistente "Do not enter card numbers..." (testo da catalogo) sotto il campo, usato ovunque ci sia un campo libero (FR-DAT-01); la regola `cardNumber` e nello schema.

**Form chiave**
- *Booking admin (new/edit)*: sezioni Dates / Vehicle / Customer / Payment / Notes; la disponibilita live usa `useActionQuery(previewBookingChange | searchAvailability)` con `role="status"`; pannello **Changes** (vecchio -> nuovo, totale, saldo) sempre visibile in edit; Customer = `Combobox` (pattern ARIA combobox di Radix/cmdk-less: implementazione con `Popover` + lista `listbox`, nessuna dipendenza nuova) con `suggestCustomers` min 2 caratteri.
- *Vehicle*: sezioni; `PhotoManager` con coda **sequenziale** (il server ha un semaforo di 2 upload): per file "Resizing… Uploading… Done", contatore "3 of 10", pulsanti Move earlier/later/Set as cover/Remove (nessun drag, WCAG 2.5.7).
- *Branding*: vedi 7.5.
- *Create tenant* (system): una pagina con tre card numerate; controllo slug live (`checkSlugAvailability`, debounce) con `role="status"`; esito email di attivazione "sent/failed/no_smtp" mostrato dopo il salvataggio con azione "Copy link / Reissue".

---

## 7. Pipeline del tema

### 7.1 Token -> CSS (build)
`scripts/build-tokens.ts` (03b sez. 12) legge `docs/design/tokens.json` (fonte unica) e genera, **committati**, con diff verificato in CI:
- `src/styles/tokens.css`: `:root { --background:#F6F8F9; ... }` (light), `@media (prefers-color-scheme: dark) { :root { ... } }` (dark), piu variabili non colore (`--radius-*`, `--shadow-*`, `--font-family-sans`, `--touch-h`, `--size-*`, `--ring-width`, durate motion). Per `/system`, auth non brandizzate e tenant senza branding e il tema piattaforma.
- `src/styles/theme.generated.css`: `@theme inline { --color-background: var(--background); --color-primary: var(--primary); ... --radius-md: var(--radius-md); --spacing-*: ... }` (Tailwind v4). Cosi `bg-primary`, `text-muted-foreground`, `border-border-strong`, `ring-ring` sono classi semantiche; `bg-primary/50` funziona con `color-mix`.
- Ruoli oltre shadcn: `primary-soft(-foreground)`, `accent-soft`, `link`, `border-strong`, `disabled-*`, `success|warning|danger|info` (+ `-soft`, `-border`) mappati 1:1; alias shadcn come da 04b 4.1 (`destructive = danger`; `popover|dialog|sheet = card`).
- Nota di allineamento: 03b sez. 12 scrive `hsl(var(--primary))`, ma i token sono **esadecimali**: si usa `var(--primary)` diretto (FE-3 / richiesta a 03b).

**Densita**: variabili definite *una volta* in `tokens.css` con media query: `--control-h: var(--size-touch)` sotto 768 px o `(pointer: coarse)`, `var(--size-pointer)` altrimenti; `--today-row-h: 48px`. I componenti usano `h-(--control-h)`; nessuna media query per-componente per la densita (equivalente funzionale dell'attributo `data-density` di 04b sez. 9, ma a costo zero di JS e senza flash).

**Divieti (lint + Semgrep, 03b sez. 12)**: nessun hex o `bg-[#...]`, nessuna classe colore Tailwind di default (`bg-red-500`: le palette Tailwind sono disattivate con `--color-*: initial` prima del `@theme`), nessun `style=`.

### 7.2 Tema tenant a runtime
`GET /{slug}/theme.css?v={themeVersion}` (route handler del backend, `renderThemeCss(deriveTheme(...))`, immutable). Il frontend:
- nel layout `[slug]` (server) rende `<link rel="stylesheet" href={themeUrl} precedence="tenant-theme" />` (React 19: nessun `<style>` inline, nessun nonce necessario perche same-origin, blocca il rendering fino al caricamento -> niente FOUC) e `ReactDOM.preload(fontUrl, { as:'font', type:'font/woff2', crossOrigin:'anonymous' })` per il file latin del font scelto;
- `themeVersion`, `fontKey`, `logo {url,width,height,alt}` arrivano da `ResolvedTenant.settings` (richiesta a backend per width/height del logo, serve a CLS e LCP);
- l'ordine di cascata: `tokens.css` (piattaforma) < `theme.css` (tenant). `theme.css` ridefinisce **le stesse variabili** per `:root`.

### 7.3 Dark mode senza flash sotto CSP stretta (nessuno script, nessun cookie)
- Modalita **auto** (default): `theme.css` emette light in `:root` e dark dentro `@media (prefers-color-scheme: dark) { :root { ... } }`, con `color-scheme: light dark`. Il browser applica dark prima del primo paint: niente script, nessun flash.
- Modalita **forzata dal tenant** (FR-BRD-05): `theme.css` emette direttamente i valori della modalita scelta in `:root` (nessuna media query) e `color-scheme: light|dark`. Il `data-theme` di ADR-0012/04b 14 **non serve** sulle pagine reali, perche la modalita e dentro il file versionato (cambiarla cambia `themeVersion`). Evita di dover leggere lo slug nel root layout per marcare `<html>`.
- Nessun interruttore utente (UX non lo prevede): nessun `localStorage`, nessun cookie di tema. Se in futuro serve, e una decisione di prodotto + SEC (cookie funzionale in admin).
- `/system` e pagine non brandizzate: `tokens.css` (auto light/dark).
- Verifica: Playwright `colorScheme: 'dark'` e `'light'` su tre palette; asserzione "primo paint gia scuro" con screenshot a `domcontentloaded`; `expectNoCspViolations`.

### 7.4 Compatibilita con la CSP (decisione 5.1: `style-src 'self' 'nonce-…'`, niente `style-src-attr`)
- Next in produzione emette CSS come `<link>` esterni (nessun `<style>` inline); non si usano `next/font`, CSS-in-JS ne `<style jsx>`.
- **L'HTML renderizzato lato server non deve contenere attributi `style=`.** Il DOM costruito dal client via CSSOM (`el.style.x = ...`, che React usa per il prop `style` dopo l'idratazione) *non* e bloccato dalla CSP; lo e l'attributo serializzato nell'HTML SSR. Quindi: (a) vietato il prop `style` in JSX (eslint `react/forbid-dom-props` + Semgrep sulla regola della decisione 5.1); (b) valori dinamici: classi enumerate (es. `col-start-1..31`, `span-1..31` per le barre del calendario, larghezza `Progress` a gradini di 5% o elemento `<progress>`), oppure `useCssVars(ref, vars)` (unico file autorizzato a chiamare `style.setProperty`, solo con valori validati) eseguito dopo il mount;
- **Audit dei componenti shadcn/Radix** in M0: ogni componente copiato viene reso in un test e si verifica che l'HTML SSR non contenga `style=` (es. `Progress`, `ScrollArea`, `Select` con posizionamento, `Tooltip`). Quelli che lo richiedono o si sostituiscono (Progress -> `<progress>`) o si rendono solo client dopo il mount (Popper e Dialog sono in portal: montati dal client, quindi ok).
- Se, nonostante questo, ABU-M5-05 mostra violazioni inevitabili, si applica la deroga prevista da 08 sez. 5.1 (`style-src-attr 'unsafe-inline'` e solo quello) e resta la regola "nessun valore da dati utente/tenant". Stima del rischio: bassa.
- JSON-LD `<script type="application/ld+json">` e un data block: non eseguito, non soggetto a `script-src`.

### 7.5 Pagina Branding (M5)
- `BrandingForm` (RHF): cinque `ColorField` (hex validato + selettore nativo `input type=color` + campo testo), `FontPicker` (RadioCard), logo (`LogoUpload` con alt obbligatorio), forzatura modalita.
- `ContrastPanel` e anteprime light/dark: la bozza non salvata va valutata con **la stessa funzione del server**. Per non portare l'algoritmo nel bundle e non importare `domain` dalla UI, `previewContrast` (BRD-06) deve restituire anche i **valori derivati** per light e dark (richiesta a backend); `ThemePreview` (client) applica le variabili con `useCssVars` a un contenitore con `data-theme-preview="light|dark"` (selettori `[data-theme-preview=dark] { color-scheme: dark }` in `globals.css`), debounce 250 ms, ultima risposta vince. Il salvataggio e comunque autorevole sul server (`updateBranding` ricalcola con la stessa `deriveTheme`).
- Righe del pannello: icona + parola (Pass, Warning, Blocked, Adjusted automatically) mai solo colore; ogni correzione e un pulsante con nuovo colore e rapporto, reversibile; motivo del blocco accanto a "Save changes".

### 7.6 Font
Tre famiglie variabili `woff2` in `public/fonts/` (latin + latin-ext come due file con `unicode-range`), dichiarate in `src/styles/fonts.css` con `font-display: swap`. Tutte e tre le `@font-face` stanno nel CSS globale: il browser scarica **solo** quella usata (`--font-family-selected` impostata da `theme.css`), come richiesto da ADR-0012. Preload del solo file latin della famiglia scelta (7.2). **Fallback con metriche abbinate** (`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override` su una `@font-face` locale di Arial) calcolati una volta offline e committati in `fonts.css` per ogni famiglia: riduce il CLS dello swap. Peso atteso per file latin: da verificare (budget carattere <= 50 kB per famiglia; subsetting `pyftsubset` in script se serve).

---

## 8. Calendario

### 8.1 Dati e viste
`CalendarPage` (RSC) legge `?view=&date=&cancelled=`, chiama `getCalendar` (BKG-13, intervallo <= 42 giorni, solo il visibile) e passa un `CalendarDto` (`vehicles`, `bookings`, `todayLocal`, `range`) a `CalendarView` (client). "Oggi" **viene dal server** (`todayLocal`, fuso del tenant): il client non conosce `Date.now()` (A-19).
- **Vista di default** quando `view` manca nell'URL: il server sceglie *Day* se `Sec-CH-UA-Mobile: ?1` o UA mobile, altrimenti *Grid*. Un piccolo `ViewPreferenceSync` (client, solo se `view` assente) confronta con `localStorage` (preferenza per dispositivo, UX W-D2) e con `matchMedia('(min-width: 768px)')` e fa `router.replace` se diverge. Costo: un secondo render solo per chi ha una preferenza diversa dal default (FE-4 per il localStorage).
- Navigazione periodo (Prev/Today/Next/data): `router.push` in `startTransition`; la vecchia griglia resta, `aria-busy="true"`, il toolbar resta attivo. Il focus attivo e ripristinato per chiave (vehicleId + giorno) alla nuova props, dentro un wrapper client che resta montato.
- **Viste**: *Grid* e *Week* (stesso componente, 7 colonne), *Month* (tabella con conteggi), *Day* (card veicolo, default phone), *Agenda* (`<ul>` raggruppata per giorno con `<h3>`; renderizzata **sempre da RSC** senza JS, raggiungibile da selettore vista e da "Skip to agenda" prima della griglia).

### 8.2 Layout e sticky (solo la griglia scorre in orizzontale)
- Contenitore di scorrimento **`<div data-calendar-grid="grid|week">`** (attributo stabile richiesto da QA-2; `data-calendar-ready="true"` quando e montato e scrollato su oggi, per evitare flakiness). E l'unico elemento con `overflow: auto`; ha `max-height: calc(100dvh - var(--sticky-top) - toolbar)` per far funzionare l'header `position: sticky; top: 0` (un contenitore con overflow-x rende sticky relativo al contenitore stesso). La **pagina** non scorre mai in orizzontale (verificato da `expectNoHorizontalPageScroll` con `allow: '[data-calendar-grid]'`).
- Colonne a larghezza fissa dai token: `grid-template-columns: var(--calendar-name) repeat(var(--days), var(--calendar-day))` con `--days` scelto da una classe (`cols-7|28|29|30|31|…`) generata in `calendar.css` (niente inline). Prima colonna `position: sticky; inset-inline-start: 0` (108 px phone, piu larga desktop) con nome a capo su due righe, mai troncato senza nome completo in `aria-label`.
- **Barre**: dentro la cella del primo giorno visibile, `position: absolute` con larghezza da classi `span-1..31` (`calc(var(--calendar-day) * N)`); continuazioni oltre la finestra clippate. Giorno condiviso (rientro la mattina e ritiro il pomeriggio sullo stesso veicolo, possibile per la regola del buffer/orari): le barre usano `data-edge="end-half|start-half"` per occupare meta cella ciascuna. Stati: confermata/attiva/completata/manutenzione/annullata con **icona + etichetta + bordo/pattern** (04b 11), colonna di oggi con tinta + etichetta "Today" + data in grassetto.
- Densita: celle >= 44 px di larghezza effettiva su touch (50 px token) e righe 56-58 px; `scroll-padding-inline-start` = larghezza colonna sticky per non coprire il focus (2.4.11).

### 8.3 Virtualizzazione: non in v1
NFR-PERF-04: 50 veicoli x 31 giorni = 1.550 celle + barre: DOM gestibile (~2.000 nodi). Ottimizzazioni: `content-visibility: auto` + `contain-intrinsic-size` sulle righe fuori vista, celle vuote leggere (un `div` senza figli), nessuna barra renderizzata per giorni fuori finestra. **La virtualizzazione per righe rompe l'ARIA grid** (serve `aria-rowcount/aria-rowindex`, roving tabindex su righe non montate, ricerca per testo, stampa) e non e giustificata sotto ~100 veicoli. Soglia di revisione: se la misura nightly NFR-PERF-04 (<= 2 s client con CPU 6x) fallisce o `maxVehicles` oltre 100, si introduce windowing per righe con `aria-rowcount` (disegno gia compatibile: `aria-rowindex` e emesso sempre). Decisione registrata come assunzione A-FE-3.

### 8.4 ARIA grid e tastiera (UX 9.3, NFR-A11Y-02)
- `role="grid"` con nome "Vehicle calendar, June 2026"; riga `role="row"`; `role="rowheader"` (nome, targa, stato in testo); intestazione `role="columnheader"` con data completa ("Fri 12 Jun 2026, today"), `aria-current="date"` su header e celle di oggi; celle `role="gridcell"`.
- **Roving tabindex** in un hook generico `useRovingGrid({ rows, cols, onActivate, onPeriodChange })`: una sola cella con `tabindex=0`, le altre `-1`; Frecce, Home/End (primo/ultimo giorno della riga), PageUp/PageDown (periodo precedente/successivo), Enter/Space attiva, Esc chiude la quick view e riporta il focus alla cella. Nessuna scorciatoia a tasto singolo senza modificatore (2.1.4). Annuncio del periodo (`role="status"`): "Showing 01 to 30 Jun 2026".
- **Prenotazione = `button`** nella cella del primo giorno visibile, nome accessibile completo ("Booking K7M2-9QXA, Fiat Panda, Rossi, 03 Jun 10:00 to 05 Jun 10:00, confirmed, unpaid"); le continuazioni sono `aria-hidden` e non focusabili; le celle coperte espongono `aria-description="Booked, K7M2-9QXA"`. Celle vuote (solo admin): nome "Fiat Panda, Fri 12 Jun, free. Press Enter to create a booking."; operatori: nessuna azione.
- **Quick view**: sotto 768 px `Sheet` modale dal basso (focus trap, Esc, ritorno del focus al trigger); da 768 px pannello laterale `aside role="dialog" aria-modal="false"` non modale con Esc. I dati ci sono gia nel DTO (nessun fetch); "Mark paid" usa `PaymentSheet` e `setPayment` (ottimistico, 5.3).
- **Month**: tabella di settimane (`th scope="col"` per i giorni, ogni giorno un `button` "12 June, 4 pickups, 3 returns"). **Day**: card elenco (RSC + isola per la quick view). **Agenda**: lista RSC, nessuna isola tranne apertura quick view.
- Scorri su oggi al caricamento: `scrollIntoView({ inline: 'center', behavior: 'auto' })` (sempre istantaneo, quindi coerente con `prefers-reduced-motion`).

---

## 9. Navigazione responsive

| Superficie | < 768 | 768-1023 | >= 1024 |
|---|---|---|---|
| Pubblico | top bar 60 (logo/titolo + "Contact"), nessun menu; barra azione sticky solo nel form di prenotazione | contenuto centrato | filtri a pannello sinistro nei risultati |
| Admin | top app bar 56 (marchio, titolo, avatar menu) + `BottomNav` 64 (Today, Calendar, Bookings, Vehicles, More solo se ci sono voci in overflow) + FAB "New booking" (solo admin; Today/Calendar/Bookings); sulle rotte-form la bottom nav e il FAB spariscono, resta la `StickyActionBar` | `SideNav` rail a icone (etichetta visibile al focus/espansione), bottone "New booking" in top bar | `SideNav` sidebar 240 con gruppi Operations / Business / Settings, breadcrumb nelle pagine profonde |
| System | top bar con hamburger -> drawer (`Sheet` laterale) | hamburger o rail | sidebar |
| Auth | card centrata senza nav | idem | idem |

Implementazione: **una sola funzione `navItems(role)`** (in `ui/layout`) produce le voci; `BottomNav` (`md:hidden`, `nav aria-label="Admin bottom navigation"`) e `SideNav` (`hidden md:flex`, `nav aria-label="Main"`) la consumano; le due varianti sono nel DOM ma quella nascosta e `display:none` (fuori dall'albero di accessibilita), nessun hook `useMediaQuery` per il layout (nessun mismatch di idratazione). "More" = `Sheet` con le voci di overflow (Customers, Revenue, Operators, Settings, Activity). Voci non permesse al ruolo sono **assenti** (non disabilitate). `aria-current="page"` dalla corrispondenza di pathname. Altezze sticky come variabili CSS (`--sticky-top`, `--sticky-bottom`) impostate da classi della shell e usate in `scroll-padding-*` (2.4.11). Landscape basso (< 500 px di altezza): header e bottom bar non restano entrambi sticky (classe `landscape-compact`).

**Tabelle -> card sotto 768**: `ResponsiveList` riceve `columns` e `renderCard`; rende `<table>` (`hidden md:table`) e `<ul>` di card (`md:hidden`) con le stesse righe (max 25 per pagina). Il titolo riga e il link (stretched link), azioni come fratelli, mai nested interactive. Ordinamento con pulsanti e `aria-sort`; paginazione con pagina in URL.

**Filtri**: `Sheet` dal basso sotto `md` (con pulsante "Show N vehicles" a conteggio live), pannello/popover da `md`, barra inline da `lg` nelle liste admin. **Overlay form** (pagamento, spesa, annullamento): sheet sotto `md`, dialog centrato da `md`; conferme brevi sempre dialog centrati con focus sull'azione sicura.

---

## 10. Componenti di stato: errore, vuoto, caricamento

Tutti in `src/ui/states` (riuso obbligatorio; copy da catalogo, vedi UX 6.1 e 04b 13):

| Componente | Uso | Dettagli |
|---|---|---|
| `Skeleton*` (`line`, `card`, `row`, `calendarRows`, `kpi`) | S-L | dopo 300 ms via CSS `animation-delay`; stesse dimensioni del contenuto; statico con `prefers-reduced-motion`; contenitore `aria-busy` + testo nascosto "Loading {thing}" |
| `EmptyState` (`variant: 'first-use' | 'filtered'`) | S-E / S-E2 | cerchio 64 px, icona 24, H3, una riga, **una** azione (filtered: "Clear filters"); sezione vuota in Today = riga muted senza azione |
| `ErrorState` | S-R | cerchio danger-soft + `triangle-alert`, motivo, "Try again", riferimento (`digest`/`requestId`); mai stack |
| `SectionBoundary` | errori per sezione | error boundary con `ErrorState` compatto, il resto della pagina vive |
| `StatusBanner` / `BannerRegion` | S-RO, abbonamento, SMTP, legale | `role="status"`, max 2 visibili ("2 more notices"), `role="alert"` solo per errori bloccanti; matrice 04a 6.3 implementata come funzione pura `selectBanners(context, role)` testata |
| `NotFoundState` / `ForbiddenState` | S-F | pagina intera, stesso testo per id inesistente e id di altro tenant |
| `SessionExpiredDialog`, `SessionTimeoutDialog` | S-T, WCAG 2.2.1 | vedi 14.2 |
| `ReadOnlyHint` | S-RO | controllo `aria-disabled` + testo visibile del motivo, ancora focusabile |

Regola nascosto/disabilitato (04a 6.1): permesso (ruolo) = assente; stato o limite = visibile, `aria-disabled`, motivo in testo. `Button` implementa `aria-disabled` (non `disabled`) + `onClick` bloccato quando `reason` e presente.

---

## 11. i18n

Lingue: **solo `en`** (decisione F23); nessun selettore, `lang="en"`. Struttura pronta per altre lingue senza ristrutturare. Libreria: **`intl-messageformat`** (ICU; assunzione di 03b da confermare in M0, TD-3). Niente `next-intl`: nessun routing per locale, e il suo peso/complessita non serve (alternativa valutata e scartata; riconsiderare se si aggiunge una seconda lingua con URL per locale).

- **Catalogo**: `src/i18n/messages/en/<namespace>.ts` (oggetti `as const`), aggregati in `src/i18n/messages/en.ts` (un solo oggetto tipizzato come in 03b: la divisione per file serve solo al limite di 300 righe; richiesta di precisazione FE-7). Namespace = primo segmento: `common`, `nav`, `errors`, `feedback`, `publicSite`, `booking`, `calendar`, `fleet`, `customers`, `finance`, `branding`, `settings`, `auth`, `system`, `a11y`, `email`, `pdf`. Chiavi `module.area.name` (camelCase nei segmenti) come `booking.errors.conflict`, `errors.validation.required`, `feedback.payment.recorded`.
- **API**: `getTranslator(locale)` (server) e `useT()` (client) con chiavi controllate a compile-time (`MessageKey`) e parametri tipizzati dal parser ICU nello script di verifica. Il server risolve tutti i testi degli RSC; il client riceve **solo i namespace necessari** al gruppo di rotte (`MessagesProvider namespaces=[...]` nel layout) per non spedire l'intero catalogo. I testi senza ICU non invocano il formatter; `intl-messageformat` e caricato solo nei bundle che usano parametri/plurali (pagine con form e admin), mai nella root pubblica (FE-D2).
- **Formati**: sempre da `shared/format` (riuso): `formatMoney(minor, currency)`, `formatDate`, `formatDateTime(tz)`, `formatDuration`, `formatList`; `en`, fuso e valuta del tenant espliciti (04a 6.4). Codici prenotazione `K7M2-9QXA` formattati con `formatBookingCode` in mono. Nota "Times are in {timeZone}" accanto ai campi data quando il fuso del browser differisce (richiede `Intl.DateTimeFormat().resolvedOptions().timeZone` solo lato client, dopo il mount, mai nel render server).
- **Errori dal backend**: l'`ActionResult` porta `messageKey` + `params` (e `message` gia risolto); la UI usa la chiave con il traduttore client per coerenza con i campi; mai testo concatenato.
- **Lint contro stringhe cablate** (bloccante in CI, `lint-types-arch`): (1) `react/jsx-no-literals` con `noStrings: true` e `allowedStrings` per soli simboli (`·`, `/`, `—`, `•`, `:`, `€` NO: la valuta passa da `formatMoney`); (2) `no-restricted-syntax` sui `JSXAttribute` `aria-label|aria-description|aria-placeholder|alt|title|placeholder|label` con valore `Literal` o `TemplateLiteral`; (3) regola Semgrep per stringhe letterali passate a `toast.*`, `setError`, `new Error` verso utente, `message:` negli schemi Zod; (4) `scripts/check-messages.ts`: chiavi usate ma assenti, chiavi presenti ma inutilizzate, parametri ICU non coerenti con i call-site, chiavi con spazi/maiuscole sbagliate, varianti `it.ts` stub che non compilano (test di tipo). Eccezioni: log, messaggi di eccezione interni, nomi di test.
- **Pseudo-localizzazione**: `PSEUDO_LOCALE=1` (solo `APP_ENV=local|ci`) trasforma il catalogo (accenti, +40% lunghezza, parentesi `[… ]`); suite Playwright di layout a 320/375 (overflow/troncamenti) come da 10-test-plan 9.6. Nessun testo dentro immagini; proprieta logiche CSS (`ms-*`, `ps-*`, `inset-inline-*`) per default; RTL non progettato.
- **Contenuti scritti dal tenant** (titolo, descrizione, note, nomi veicoli, alt del logo): mostrati come dati; il resto della UI e inglese.

---

## 12. Checklist di implementazione dell'accessibilita (WCAG 2.2 AA; origine 04a sez. 9 e 04b sez. 15)

Ogni voce e un criterio di Definition of Done per PR che tocca UI; "T" = test automatico, "M" = verifica manuale.

| # | Implementazione | Test |
|---|---|---|
| 1 | `<html lang="en">`, landmark `header/nav/main/footer`, un solo `h1` per pagina (`PageTitle` con `tabIndex={-1}`), titoli univoci "{Page} · {Tenant title}", nessun salto di livello | axe T, regola `jsx-a11y` |
| 2 | `SkipLink` come primo focusabile; il calendario aggiunge "Skip calendar" e "Skip to agenda" | Playwright T |
| 3 | **Focus a ogni navigazione client**: `RouteFocus` (client) sposta il focus su `h1[data-page-title]` al cambio di `pathname` (non per i soli search params); il route announcer di Next annuncia il titolo | Playwright T |
| 4 | Dialog/Sheet/AlertDialog Radix: focus trap, Esc, ritorno al trigger, sfondo inerte; azione sicura con focus iniziale nei dialoghi distruttivi | component T + Playwright |
| 5 | Dopo submit fallito il focus va all'`ErrorSummary`; dopo cancellazione, al prossimo elemento o al titolo lista; dopo caricamento della conferma, al titolo | component T |
| 6 | Etichette visibili, nome accessibile = etichetta visibile (2.5.3), pulsanti icona con `aria-label` da catalogo, "Select" con nome del veicolo, link distinguibili (sottolineati) | `jsx-a11y` + axe |
| 7 | Errori: `aria-invalid`, `aria-describedby`, icona + testo; stati con `role="status"`/`aria-live="polite"` (conteggi risultati, salvataggi, disponibilita, contrasto, copia codice); errori bloccanti `role="alert"` | component T |
| 8 | Target 44x44 su touch (`--control-h`), mai < 24x24 con spaziatura (2.5.8); azioni di riga >= 32 su desktop | `expectTouchTargets` T (320/375/390) |
| 9 | Nessun drag-only (2.5.7): riordino foto con pulsanti | M |
| 10 | Nessun CAPTCHA/enigma; `autocomplete` corretti (`given-name`, `family-name`, `tel`, `email`, `username`, `current-password`, `new-password`), incolla consentito, mostra/nascondi password | component T (attributi tipizzati nelle props di `FormField`) |
| 11 | Timeout sessione: dialog 2 minuti prima, focus su "Stay signed in" (2.2.1) | Playwright con `page.clock` T |
| 12 | Colore mai unico segnale: stati = icona + testo (+ bordo/pattern in calendario); saldo = parola + segno; oggi = etichetta + peso; validazione = icona + testo | axe + M |
| 13 | Reflow a 320 px e zoom 200%: nessun contenitore a altezza fissa su testo, `overflow-wrap: anywhere` su email/codici/URL; calendario unica eccezione | `reflow-320` T |
| 14 | `prefers-reduced-motion`: CSS globale azzera animazioni/transizioni, skeleton statici, nessuna animazione di scroll; spinner sostituito dalla label | Playwright `reducedMotion: 'reduce'` T |
| 15 | Tooltip solo per suggerimenti non essenziali (1.4.13: chiudibili con Esc, hoverable, persistenti); motivi di disabilitazione sempre testo visibile | M |
| 16 | `forced-colors: active`: chip con bordo, focus con `outline`, barre calendario con contorno (varianti `forced-colors:`) | Playwright `forcedColors: 'active'` smoke |
| 17 | Immagini: card veicolo `alt=""` quando il nome e adiacente (decisione UX 9.1.18), galleria con alt significativo, logo con alt dal tenant, icone decorative `aria-hidden`; vedi FE-6 per il conflitto con SEO SR-15 | axe + M |
| 18 | Anello di focus 3 px + offset 2 px (`--ring`) su ogni focusabile, mai rimosso; `scroll-padding-*` pari alle altezze sticky (2.4.11) | Playwright: focus non coperto da bottom nav/FAB/sticky bar |
| 19 | Calendario: griglia ARIA + Agenda (sezione 8.4) | Playwright tastiera T + M (VoiceOver/NVDA) |
| 20 | Pagina di errore/404/503: titoli e `h1` presenti, link home | axe T |

axe (`wcag2a, wcag2aa, wcag21aa, wcag22aa`) su ogni classe di rotta e ogni stato dei wireframe, in light, dark e con tre palette tenant (10-test-plan 9.1): **zero violazioni serious/critical** come gate; best-practice solo riportate. Verifica manuale: tastiera su ogni flusso, VoiceOver iOS + NVDA/Firefox (pubblico, calendario, modifica prenotazione), zoom 320.

---

## 13. Performance: budget, immagini, caricamento

### 13.1 Budget (misurato su 4G simulato, mobile, 30 veicoli; p75 approssimato dalla mediana di 5 run, 10-test-plan sez. 10)

| Pagina | LCP | INP | CLS | TTFB | JS first-load (gzip) |
|---|---|---|---|---|---|
| `/{slug}` | <= 2,5 s (elemento LCP = H1 o logo) | <= 200 ms | <= 0,1 | <= 800 ms (SEO SR-14) | **<= 150 kB** (SR-14, NFR-PERF-01), obiettivo <= 125 |
| `/vehicles` | <= 2,5 s | <= 200 | <= 0,1 | <= 800 | **<= 170 kB** (proposta) |
| `/book`, `/booking/{code}` | <= 2,5 s | <= 200 | <= 0,1 | <= 800 | **<= 200 kB** (RHF + Zod + ICU), conferma <= 150 |
| Admin (pagine) | <= 3 s su Fast 3G CPU 4x | <= 200 | <= 0,1 | n/a | <= 250 kB, calendario <= 280 (proposta, soglie da rivedere con la prima misura) |

Calendario mese 50x31: <= 2 s lato client con CPU 6x (NFR-PERF-04). Il numero reale del runtime Next 15 (React 19) e **da misurare in M0** su un'app vuota (spike S-FE-1): se supera ~110 kB gzip il budget di 150 kB della root lascia pochissimo e va rinegoziato (FE-2).

### 13.2 Come si rispetta
- Root senza client component (FE-D2); `lucide-react` a import nominali; Radix solo dove serve; niente librerie per cose banali (date native `input type="date"` + `select` per ora a passi di 15 minuti, come da SEO e UX; niente moment/dayjs lato client, niente lodash, niente libreria di animazione: transizioni CSS).
- Code splitting per rotta (App Router); `next/dynamic` per le isole pesanti non critiche (`FiltersSheet` caricato all'apertura, `QuickView`, `ContrastPanel`, `PaymentSheet`).
- **Gate deterministici in PR**: `tests/e2e/perf/js-budget.spec.ts` carica le pagine nel compose stack, somma i byte *trasferiti* degli script (CDP `Network.loadingFinished.encodedDataLength`, con compressione attiva) e confronta con la tabella; numero di richieste e assenza di host di terzi; `expectNoCspViolations`; peso del DOM (nodi) sul calendario. **Gate temporali nightly**: Lighthouse CI (`@lhci/cli`, 5 run) con tolleranza 10% (10-test-plan sez. 10).

### 13.3 Immagini
- `<img>` semplici (non `next/image`, vedi sez. 1): `src` 480 + `srcset="…-480.webp 480w, …-1280.webp 1280w"` + `sizes` per colonna, `width`/`height` espliciti e `aspect-ratio` 16:9 con `object-fit: cover` (CLS), `decoding="async"`; le prime due card `loading="eager"` (la prima `fetchpriority="high"` solo se e l'LCP, che in `/vehicles` puo esserlo), le altre `lazy`. Placeholder: gradiente tinto + icona `car` in CSS (nessuna richiesta).
- Logo: `<img>` con `width`/`height` dal DTO, `fetchpriority="high"` in root (SEO SR-14), WebP <= 480 px di larghezza.
- Nessuna immagine hero; nessun testo nelle immagini; l'immagine OG e prodotta dal backend.
- Le varianti prodotte dal backend sono 480 e 1280 (06 10.3), mentre 04b sez. 17 parla di 480 e 960 e UX W-P2 di rapporto 4:3 (04b sez. 17: 16:9): si segue **backend (480/1280)** e **16:9**, vedi FE-6.

### 13.4 Upload e ridimensionamento lato client (limite 4 MB, 12 MB da telefono)
`ui/lib/downscale-image.ts`: `createImageBitmap(file, { imageOrientation: 'from-image' })` -> canvas con lato lungo <= 2000 px -> `toBlob('image/jpeg', q)` (q=0,85, ridotta a passi di 0,05 e poi dimensioni ridotte finche <= 3,5 MB); PNG con trasparenza (logo) resta PNG e lato lungo <= 512 px; input `accept="image/jpeg,image/png,image/webp"` senza `capture` (camera o galleria; iOS converte HEIC in JPEG); decodifica fallita -> "Use a JPEG, PNG or WebP image." Nessuna dipendenza (evita `browser-image-compression`, 03b dependency policy). `ui/lib/upload-blob.ts`: **XHR** (serve `upload.onprogress`; `fetch` non lo ha) con corpo raw (BE-D2), `X-Request-Id` letto dalla risposta, mappa problem+json -> `ActionResult`-like. Coda sequenziale. CSP: `blob:` serve solo per l'anteprima (`img-src blob:`, SR-HDR-02) e per il download esportazioni (`URL.createObjectURL`).
Download esportazioni (POST, 06 7.1): `useFileDownload` -> `fetch` POST, se `!ok` legge il problem+json e mostra l'errore inline (`EXPORT_IN_PROGRESS`, `EXPORT_ROW_CAP_EXCEEDED`), se ok scrive il flusso in `Blob` e scatena `a[download]`; un form nativo mostrerebbe una pagina JSON in caso di errore.

### 13.5 Caching HTTP lato browser
`/media/*` e `theme.css?v=` immutable (backend); HTML sempre `no-cache`/`no-store` (header matrix). Font `public/fonts/*` con `Cache-Control: public, max-age=31536000, immutable` e nome file con hash di contenuto (l'URL cambia al cambio di versione). Nessun service worker, nessuna PWA in v1.

---

## 14. Autenticazione e sicurezza lato client

### 14.1 Sessione
Cookie `__Host-rc_tenant` / `__Host-rc_system` **HttpOnly**: il client non vede mai il token, non c'e `localStorage`/Bearer. Il client non decide l'accesso: le pagine chiamano `requireStaffPage`, le azioni `Guard`. L'unica informazione di sessione che arriva al client e `{ role, displayName, idleExpiresInMs, mustChangePassword }` (DTO) nel provider della shell. Le pagine pubbliche non leggono ne impostano cookie (test: nessun `Set-Cookie`, SR-GDPR-02).

### 14.2 Scadenza e ripresa
- `SessionClock` (client, renderizzato da `AdminPage` ad ogni navigazione) riceve `idleExpiresInMs` (30 min staff / 15 min system) e rinfresca un timer **relativo** (`setTimeout`, nessun `Date.now()`); ogni risposta di server action `ok` rinnova il timer di `idle` completo (il server estende al massimo ogni 60 s).
- A `T-2 min`: `SessionTimeoutDialog` ("You'll be signed out in 2 minutes", focus su "Stay signed in", azione `touchSession`). A scadenza: `SessionExpiredDialog` (S-T) con form di login in-place (`loginStaff`/`loginSystem`), stato dei form in memoria, **un** retry dell'azione fallita dopo il login. Multi-tab non sincronizzato in v1 (si scopre alla prima azione; R-FE-5).
- `mustChangePassword` -> la shell mostra solo `account` e logout.
- Pagine token (`activate`, `reset-password`): GET legge `peekCredentialLink` (usato/scaduto/non valido con messaggi distinti, 06 X6); il client **toglie il token dalla barra** con `history.replaceState` al mount e lo tiene in memoria per il POST (X5); `Referrer-Policy: no-referrer` dagli header centrali.
- `next=` dopo login: `safeNextPath()` accetta solo percorsi relativi sotto `/{slug}/admin` (o `/system`), nessun open redirect.

### 14.3 Sicurezza del bundle
Nessun segreto nel bundle (solo `NEXT_PUBLIC_*` assenti: non se ne definiscono; l'unica config verso il client e il DTO del provider tenant). Verifica in CI: grep del build output per variabili note e canary (`INSECURE_DEV_`), `gitleaks`. Nessun `eval`, nessuna URL costruita da input utente verso l'esterno; link esterni dei tenant (privacy/terms) solo `https:` con `rel="noopener noreferrer"` e testo "(opens in new tab)". Dipendenze: policy 03b (licenza allowlist, versioni bloccate, audit); candidati nuovi lato client: `react-hook-form`, `@hookform/resolvers`, `intl-messageformat`, `sonner`, `lucide-react`, Radix (via shadcn) con `class-variance-authority`, `clsx`, `tailwind-merge`. Nessun'altra libreria senza motivazione in PR.

---

## 15. Osservabilita frontend, analytics, consenso

- **Analytics / consenso cookie**: nessuno. FR-PUB-13 e NFR-GDPR-07 vietano cookie non essenziali e richieste a terzi; non serve banner e non va aggiunto (aggiungerlo implicherebbe tracciare). Eventuale analytics futuro: decisione di prodotto + SEC + aggiornamento informativa.
- **Error tracking**: **nessun SDK browser** (SR-LOG-08, `12-osservabilita.md`: Sentry solo server, niente `@sentry/nextjs`). Errori di render server: `onRequestError` (backend) li registra; la UI mostra come riferimento `error.digest` (Next lo collega al log server). Richiesta all'observability-engineer: includere `digest` nel campo dell'evento `app.error.unhandled` per poter cercare il riferimento che l'utente vede (FE-9). Errori delle server action: `requestId` nel risultato, mostrato in `ErrorState`/banner con pulsante "Copy reference". Errori di upload e export: `x-request-id` dalla risposta.
- **Limite noto**: eccezioni lanciate solo nel browser dopo l'idratazione (handler di eventi) arrivano al massimo a `error.tsx` ma non vengono inviate da nessuna parte. Un endpoint di segnalazione sarebbe una scrittura non autenticata (stesso motivo per cui 08 SR-HDR-02 esclude il CSP report endpoint). Accettato in v1 (rischio R-FE-6); alternativa in FE-5.
- **RUM / Core Web Vitals**: nessun RUM in produzione v1 (richiederebbe un beacon verso un endpoint: stesso problema e FR-PUB-13). Misura in laboratorio: Lighthouse CI + Playwright (10-test-plan 10). Per i dati di campo si usa la vista Core Web Vitals di Search Console quando ci sara traffico (SEO sez. 14).
- **Propagazione dell'ID di traccia**: il browser non genera ID di richiesta (il middleware li crea, 12 sez. 2). Il client conserva e mostra il `requestId` dei risultati; il `traceparent` e riservato a OTel (oggi spento): nessun lavoro frontend ora. Il test di correlazione di `12-osservabilita.md` (x-request-id su action, handler e job) copre le azioni; per le pagine RSC l'ID e nell'header `x-request-id` della risposta.
- **Telemetria da test**: nessun hook di test nel bundle di produzione. QA-2: `data-calendar-grid` (e `data-calendar-ready`) sono attributi **permanenti e innocui**, presenti anche in produzione; nessun altro `data-testid` salvo accordo (sez. 16.2).

---

## 16. Piano di test frontend

### 16.1 Livelli
| Livello | Strumento | Cosa | Dove |
|---|---|---|---|
| Unit funzioni/hook | Vitest | `parseMoneyInput`, `selectBanners`, `error-presentation`, `useRovingGrid` (logica pura di navigazione), `safeNextPath`, `json-ld` (escape `<`), `downscale-image` (dimensioni/qualita con canvas fake), `applyActionResult`, `check-messages` | colocati `*.test.ts(x)` |
| Componenti | Vitest + Testing Library + `user-event` + `jest-dom` (+ `vitest-axe` come rete di sicurezza veloce) | form (validazione on blur, riepilogo errori con focus, mapping `fieldErrors`, pending, conflitto S-X, `PRICE_CHANGED`), `FormField`, `EmptyState/ErrorState`, `BannerRegion`, `ResponsiveList`, `PhotoManager` con upload fake, `ContrastPanel` con risposte fake, `SessionTimeoutDialog` con fake timers, **render SSR di ogni componente shadcn con test "nessun `style=` nell'HTML"** | colocati |
| E2E | Playwright (progetti di 10-test-plan 6.1) + `@axe-core/playwright` | flussi di 6.2 con page object; viewport 320/360/375/390/412/768/1024/1280; light/dark; tre palette; `reducedMotion`; `forcedColors`; CSP listener; assenza cookie sul pubblico; budget JS | `tests/e2e` |
| Visivo | Playwright `toHaveScreenshot` | pagine chiave x 3 palette x light/dark, font self-hosted, baseline solo via PR | nightly + M5 |
| Performance | Lighthouse CI + `js-budget.spec.ts` | sez. 13 | PR (JS) / nightly (tempi) |
| Architettura | dependency-cruiser + ESLint boundaries | `ui` non importa `app/`, `infrastructure`, `platform`; `application` solo `schemas`/`dto` | CI |

Regole: componenti testati con **fake iniettati via props** (FE-D6), nessun `vi.mock` di moduli; i test non dipendono dal layout CSS di jsdom (la geometria e verificata in Playwright); nomi dei test in inglese; un bug UI inizia con un test rosso.

### 16.2 Selettori e attributi di test
Priorita a ruoli/etichette (verifica anche l'accessibilita). `data-testid` ammessi solo se non c'e un ruolo naturale, elencati in `tests/e2e/pages/selectors.md`. Attributi stabili concordati: **`data-calendar-grid`** sul contenitore di scorrimento del calendario (valore = vista; usato da `expectNoHorizontalPageScroll({ allow })`), **`data-calendar-ready`**, `data-page-title` sull'H1, `data-density` non serve (CSS). Gli attributi non cambiano con il tema o la lingua.

### 16.3 Page object (`tests/e2e/pages/`, uno per pagina, metodi in inglese, nessuna asserzione dentro i page object salvo `expectLoaded()`)
`PublicSearchPage` (`fillDates`, `search`, `contactBlock`), `ResultsPage` (`openFilters`, `applyFilters`, `selectVehicle(name)`, `cards`), `BookingFormPage` (`fillCustomer`, `confirm`, `errorSummary`, `banner`), `ConfirmationPage` (`code`, `downloadPdf`), `TenantStatePage` (503/410/404 copy), `AdminLoginPage`, `SetPasswordPage`, `TodayPage`, `CalendarPage` (`switchView(view)`, `scroller()` = `[data-calendar-grid]`, `cell(vehicle, isoDate)`, `bookingButton(code)`, `pressKey`, `quickView`, `agenda`), `BookingsPage`, `BookingDetailPage` (`recordPayment`, `complete`, `cancel`), `BookingEditPage` (`changesPanel`, `save`, `conflictBanner`), `VehicleFormPage` (`addPhoto(path)`, `photoRow(n)`), `VehiclesPage`, `RevenuePage`, `BrandingPage` (`setColour`, `contrastRow(name)`, `preview(mode)`), `SettingsPage`, `SystemTenantsPage`, `CreateTenantPage`, `AdminNav` (`bottomNav`, `sideNav`, `openMore`). Helpers condivisi di 10-test-plan 6.3 (`expectNoHorizontalPageScroll`, `expectTouchTargets`, `runAxe`, `expectNoCspViolations`, `withTenantPalette`) e un `focusIsNotObscured(page)` (confronta il bounding box dell'elemento attivo con le barre sticky; 2.4.11).

### 16.4 Clock e determinismo (richiesta di QA)
- **Nessun hook di clock nel frontend.** "Oggi" e le scadenze arrivano dal server (FE-D9): il clock server di test (`/api/test/clock`, solo `APP_ENV=ci`, a carico del backend) e `page.clock.install({ time })` di Playwright per i timer del browser (dialog di sessione, `fastForward`) bastano. Il test "highlight di oggi con browser in un altro fuso" (TC-CAL-03) funziona perche il client non usa il proprio fuso.
- Dati: seed sintetici deterministici (builders); animazioni disattivate nei test con `reducedMotion: 'reduce'` (le attese si basano su ruoli/stati, non su timeout).

### 16.5 Mappatura sui criteri
AC5 (calendario, ordine naturale, viste, oggi) -> `CalendarPage` + tastiera + Agenda; AC9/AC11 (tema/375/contrasto) -> palette x light/dark x 320..1280 + axe + overflow; AC3/AC4 (pubblico) -> flusso mobile; FR-UX-06 -> tabella 6.2 di 10-test-plan con i page object sopra; NFR-A11Y-02 -> tastiera griglia + Agenda + manuale.

---

## 17. Stima, rischi, assunzioni, richieste, domande

### 17.1 Stima (giorni-persona, un frontend senior; include test di componente, E2E dei flussi proprie, axe; escluse backend e devops)
| Milestone | Contenuto frontend | gg |
|---|---|---|
| M0 | Scaffold Next/Tailwind v4/shadcn, `build-tokens`, `ui/form` + `ui/states` + `ui/layout` base, i18n (catalogo, `useT`, `check-messages`, lint), `useActionRunner`, setup Vitest+RTL e Playwright (page object base, helper, axe, budget JS), audit shadcn vs CSP, spike S-FE-1/S-FE-2 | 8-10 |
| M1 | Auth (login, forgot, reset, activate, account, sessioni), shell admin e system (nav responsive, banner, `SessionClock`), console tenant (lista, creazione, dettaglio), stati tenant | 12-15 |
| M2 | Sito pubblico (root + SEO/JSON-LD, risultati + filtri, form prenotazione, conferma, legal, stati), veicoli admin (lista, dettaglio, form, foto con downscale/upload), integrazione `theme.css`/font | 16-19 |
| M3 | Today, calendario (Grid/Week/Month/Day/Agenda, ARIA grid, quick view), prenotazioni (lista, dettaglio, new/edit con pannello Changes e disponibilita live), clienti, operatori, activity | 20-25 |
| M4 | Spese, revenue (overview/by vehicle/compare/storico snapshot), export CSV con download | 8-10 |
| M5 | Branding (contrasto, anteprime, font, logo), impostazioni, hardening responsive (320..1280), sweep axe 3 palette x light/dark, regressione visiva, pseudo-loc | 10-13 |
| M6 | UI GDPR (anonimizza, export), rifiniture di performance, correzioni da audit SEO/Lighthouse/DAST | 5-7 |
| **Totale** | | **79-99 (circa 16-20 settimane per uno sviluppatore)** |

Parallelismo: dopo M0 il lavoro e per quasi tutto sequenziale con il backend di ogni milestone (sviluppo contro contratti 06); il frontend puo partire con fake delle azioni.

### 17.2 Rischi
| ID | Rischio | Gravita | Mitigazione |
|---|---|---|---|
| R-FE-1 | **Status HTTP 410/503 non producibili da un Server Component** (SEO sez. 5): servono middleware Node o un percorso alternativo; dipende da versione di Next e dall'host (ancora da decidere) | Alta | Spike S-FE-2 in M0 (rewrite con `status` da middleware Node-runtime, oppure route handler dedicato per gli stati non-ok); fallback 200 + `noindex` documentato e accettato dal SEO. Domanda FE-1 |
| R-FE-2 | Budget 150 kB gzip sulla root troppo stretto rispetto al runtime di Next | Alta | Root senza client component, misura in M0, soglia rinegoziabile con SEO; verifica in CI |
| R-FE-3 | Componenti shadcn/Radix che emettono `style=` nell'HTML SSR rompono la CSP stretta | Media | Audit in M0, sostituzioni (`<progress>`), deroga solo `style-src-attr` come da 08 sez. 5.1 |
| R-FE-4 | Guard "modifiche non salvate" non copre tutte le navigazioni (App Router senza eventi di route change) | Media | Copertura dichiarata: link dell'app + chiusura tab + indietro; test dedicato; limite documentato |
| R-FE-5 | Piu tab: la scadenza di sessione si scopre alla prima azione | Bassa | S-T con retry; `BroadcastChannel` rinviato |
| R-FE-6 | Errori solo-browser non segnalati (nessun SDK) | Media | Riferimento `digest`, test E2E con console error, revisione periodica; alternativa FE-5 |
| R-FE-7 | Tailwind v4 / `@theme` + shadcn: compatibilita e browser minimi (Safari 16.4+, Chrome 111+; NFR-COMP-01 richiede iOS 16+ e ultime 2 versioni: ok, **iOS 16.0-16.3 escluso**) | Media | Verifica in M0; fallback Tailwind v3 con preset generato (FE-3) |
| R-FE-8 | Calendario lento su telefoni di fascia media con molti veicoli | Media | Misura nightly NFR-PERF-04, `content-visibility`, soglia per windowing (sez. 8.3), vista Day di default su phone |
| R-FE-9 | Selezione vista di default via UA/Client Hints errata (tablet) -> secondo render | Bassa | `ViewPreferenceSync` corregge; nessun effetto sulla correttezza |
| R-FE-10 | Foto retina su card: `srcset` sceglie la variante 1280 (piu pesante) | Media | Verifica peso in Lighthouse; richiesta variante 960 (FE-6) |

### 17.3 Assunzioni (da confermare)
- **A-FE-1** Next.js ultima major stabile e React 19 con pinning in M0 (AS-5); Tailwind v4 CSS-first; Zod 4 (peso client ridotto) o 3, da decidere in M0 con la misura del bundle.
- **A-FE-2** `intl-messageformat` come formatter (TD-3); catalogo diviso per namespace in file separati.
- **A-FE-3** Flotta massima ragionevole <= ~100 veicoli per tenant (piano `maxVehicles`) per rinviare la virtualizzazione.
- **A-FE-4** Nessun tema scuro/chiaro scelto dall'utente; solo dispositivo + override del tenant.
- **A-FE-5** Nessun grafico in v1 (UX li marca "Could"); se servono, tabella come alternativa testuale e libreria SVG leggera da valutare.
- **A-FE-6** Orario/data di ritiro e riconsegna con `input type="date"` nativo + `select` a passi di 15 minuti (UX "Date picker"; SEO ne consiglia l'uso).
- **A-FE-7** Le server action sono richiamabili da componenti client passate come prop (supporto nativo di Next); i test usano fake.
- **A-FE-8** Il backend fornisce nei DTO: `todayLocal`, `idleExpiresInMs`, `logo {url,width,height,alt}`, `themeVersion`, `fontKey`, `formToken` con chiave di idempotenza, valori derivati in `previewContrast`.

### 17.4 Richieste ad altri documenti e agenti (non modifiche dei loro file)
| A | Richiesta |
|---|---|
| solution-architect (03b) | (1) consentire `ui -> application/schemas.ts` e `dto.ts` (solo questi) con regola dependency-cruiser; (2) catalogo i18n diviso in `messages/en/<namespace>.ts`; (3) `var(--x)` al posto di `hsl(var(--x))` (token esadecimali) e Tailwind v4 `@theme` al posto del "preset"; (4) registrare i riferimenti UI in sez. 6 (`ui/form/form-shell.tsx`) |
| backend-developer (06) | DTO elencati in A-FE-8; `previewContrast` restituisce i valori derivati; esiti `previewBookingChange` utilizzabili in anteprima; meccanismo status 410/503 (S-FE-2); `RATE_LIMITED.retryAfterSeconds` sempre presente |
| seo-specialist (09) | Conferma budget per classe di pagina (FE-2); alt delle foto in card (FE-6); accettazione del fallback 200+noindex per 503/410 se lo spike fallisce |
| security-engineer (08) | Parere su: localStorage per la preferenza vista (FE-4); bozza prenotazione solo in memoria; `useCssVars` via CSSOM e la regola Semgrep sul `style` |
| observability-engineer (12) | Campo `digest` in `app.error.unhandled` (FE-9) |
| qa-engineer (10) | Risposta a QA-2: attributo `data-calendar-grid` (+ `data-calendar-ready`); QA-1: nessun hook di clock lato frontend (sez. 16.4); elenco page object di 16.3 |
| ui-designer (04b) | Conferma 16:9 vs 4:3 e varianti 480/1280; densita via CSS media query invece di `data-density`; assenza di `data-theme` sulle pagine reali |

### 17.5 Spike previsti in M0
- **S-FE-1** App Router vuoto + `next build`: peso JS gzip della root (target runtime <= ~110 kB) e verifica nonce/CSP con `script-src 'strict-dynamic'`.
- **S-FE-2** Status HTTP: provare (a) `NextResponse.rewrite(url, { status })` da middleware Node-runtime, (b) route handler che rende lo stato, (c) comportamento di `notFound()` con/senza `loading.tsx`; esito -> FE-1.
- **S-FE-3** Audit CSP dei componenti shadcn (HTML SSR senza `style=`), Tailwind v4 su Safari 16.4.

---

## 18. Esito, domande

(vedi blocco Esito e tabella domande nel messaggio di ritorno; gli ID FE-n sono qui definiti)

| ID | Tema | Riferimento |
|---|---|---|
| FE-1 | Come ottenere 503/410 reali sulle pagine pubbliche | R-FE-1, S-FE-2 |
| FE-2 | Budget JS per classe di pagina | 13.1 |
| FE-3 | Tailwind v4 contro v3 + preset | 7.1 |
| FE-4 | Preferenza vista calendario in `localStorage` | 3 (regola 7), 8.1 |
| FE-5 | Segnalazione errori solo-browser | 15 |
| FE-6 | Immagini: varianti 480/1280, 16:9, alt nelle card | 13.3 |
| FE-7 | Precisazioni a 03b (ui->schemas, catalogo diviso) | 3 (regola 4), 11 |
| FE-8 | Bozza prenotazione pubblica solo in memoria | 6 |
| FE-9 | `digest` nei log server | 15 |

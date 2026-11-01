# Osservabilita: RentCar

Versione 1.0 · 2026-11-01 · Owner: observability-engineer · Stato: analisi (Fase 4, onda B), nessun codice
Input: `docs/03-inputs/observability-options.md` (Opzione A accettata), ADR-0014, `docs/03b-struttura-codice.md`, `docs/05-database.md` (5.15 `email_log`, 5.16 `job_runs`, 5.19 `security_event`, 5.20 `platform_audit`), `docs/08-security.md` (SR-LOG-01..08, SR-AUD-*, SR-GDPR-05), `docs/02-requisiti.md` (FR-PLT-05/06/08, NFR-OBS-01..03, KPI-7).
Vincoli di progetto: criticita bassa (D14), nessun alerting ne reperibilita ora (G27), solo free tier dietro adapter (G30), hosting rinviato, UE, nessun dato personale nei log. **Rischio residuo accettato (RK-10): "rilevazione senza allerta" fino al GATE 4.** CSM-1 (email minime) e ancora aperta.
Regola linguistica: codice, nomi di evento, campi, variabili d'ambiente e messaggi di log in inglese; questo documento in italiano.

---

## 1. Principi e decisioni di sintesi

1. **Tre fonti durevoli, indipendenti da ogni fornitore**: log JSON su stdout, tabelle del prodotto (`job_runs`, `email_log`, `security_event`, `audit_log`, `platform_audit`), pagina KPI del systemadmin. Tutto il resto (Sentry, Grafana, OTel) e opzionale e si accende con variabili d'ambiente.
2. **Nessuna rilevazione attiva**: nessuno viene avvisato. Chi gestisce il prodotto "guarda" la pagina di stato del systemadmin (sezione 9) e, se disponibili, i log dell'host. Questo e coerente con RK-10 e va ricordato nel go-live.
3. **Eventi con nome stabile** (sezione 5) che sono gia l'input degli alert futuri (CSM-1) quando si decidera di farli.
4. **Riconciliazione con i documenti esistenti** (vincolante per il backend):
   - I campi di log sono quelli di SR-LOG-01 in `snake_case` (`request_id`, `tenant_id`, `actor_id`...). Il mio documento di Fase 3 usava camelCase: **superato da questo**.
   - Gli IP compaiono nei log **solo** come `ip_prefix` + `ip_hmac` (SR-LOG-01, decisione 5.6). Il documento di Fase 3 diceva "nessun IP": superato.
   - Tabelle reali: `job_runs` (status `succeeded|failed|skipped`), `email_log` (status `pending|sending|sent|failed|abandoned`), non `JobRun`/`EmailLog` con altri stati.
   - `ErrorReporter` ha la firma di 03b (`capture(error, context)`), piu `flush`. Le variabili sono `OBS_*` (ADR-0014 e 03b linea "OBS_*"); 03b riga 160 cita `ERROR_REPORTER`: **da allineare a `OBS_ERROR_REPORTER`** (nota per il solution-architect/backend, non e una decisione dell'utente).
   - La tassonomia degli eventi di sicurezza e quella di SR-LOG-03, senza aggiunte (il lockout e `auth.login.failure` con `reason_code=account_locked`).

---

## 2. Progetto del logger (`src/platform/logging`)

### 2.1 Componenti

| File (percorso pianificato) | Responsabilita |
|---|---|
| `platform/logging/logger.ts` | Factory pino. Opzioni: `level` da `OBS_LOG_LEVEL`, `timestamp: () => ',"ts":"' + new Date().toISOString() + '"'` (campo `ts`, ISO 8601 UTC, via `Clock` iniettato nei test), `messageKey: 'message'`, `base: { service, env, version }`, `formatters.level` -> stringa, `mixin()` che legge il contesto di richiesta, `formatters.log()` che applica l'allowlist, `redact` come seconda difesa, `serializers.err` custom (2.4). |
| `platform/logging/context.ts` | `AsyncLocalStorage<RequestContext>`: `runWithContext(ctx, fn)`, `getContext()`, `withContext(patch, fn)` (figlio con `tenant_id` aggiunto, usato dai job per tenant), `captureContext()` per `after()`. |
| `platform/logging/fields.ts` | Tipo `LogFields` chiuso e array `ALLOWED_FIELDS`. E la fonte unica per tipo, filtro runtime e test. |
| `platform/logging/redaction.ts` | Lista dei path di redazione e funzione `scrubString` usata anche dall'adapter Sentry. |
| `platform/logging/index.ts` | Esporta il tipo `Logger` (interfaccia stretta: `info/warn/error(event, fields?)`, niente stringhe libere) e `createLogger`. Nessun modulo importa pino direttamente (regola CI: `pino` solo in `platform/logging`). |
| `platform/logging/testing.ts` | `CapturingLogSink` (array di righe parse-ate) per `buildTestContainer`. |

Il logger e iniettato (`deps.logger`) come prescrive 03b; nessun singleton globale fuori da `composition/`. Il logger "di richiesta" arricchisce automaticamente ogni riga con il contesto ALS tramite `mixin`.

### 2.2 Interfaccia

```ts
// Closed set of keys. Anything else is dropped at runtime and fails the type check.
type LogFields = {
  route_template?: string; method?: string; status?: number; duration_ms?: number;
  outcome?: 'success' | 'failure' | 'conflict' | 'rejected' | 'skipped';
  reason_code?: string;            // snake_case code, never exception text
  error_code?: string;             // AppError code or SQLSTATE
  error_name?: string;
  entity_type?: string; entity_id?: string;   // uuid or booking code, never names
  count?: number; processed?: number; failed?: number;
  job?: string; period_key?: string; attempt?: number;
  email_template?: string; email_log_id?: string; email_status?: string;
  ip_prefix?: string; ip_hmac?: string;
  [K in 'tenant_id' | 'actor_id' | 'request_id' | 'realm']?: string; // normally from context
};
interface Logger {
  info(event: EventName, fields?: LogFields): void;
  warn(event: EventName, fields?: LogFields): void;
  error(event: EventName, fields?: LogFields): void;
  debug(event: EventName, fields?: LogFields): void;   // refused when APP_ENV is production-like
}
```
`EventName` e un'unione di letterali generata dal registro degli eventi (sezione 5): un evento non registrato non compila. `message` e una costante derivata dal registro (inglese, es. `"Booking created"`), mai costruita con dati (SR-LOG-01, chiude AL-05 log injection).

### 2.3 Campi di ogni riga

Obbligatori (da base/mixin): `ts` (ISO 8601 UTC, nome di SR-LOG-01), `level`, `message`, `event`, `service` (`rentcar`), `env` (`APP_ENV`), `version` (SHA/tag di build iniettato a build time), `request_id`, `realm` (`tenant|system|public|job`).
Quando noti: `tenant_id`, `actor_id` (uuid interno di staff, mai un nome o email), `route_template`, `status`, `duration_ms`, `outcome`, `reason_code`, `error_code`, `ip_prefix`, `ip_hmac`.
Riservati per OTel (oggi assenti): `trace_id`, `span_id`, popolati da `mixin` solo se `OBS_OTEL_ENABLED=true`.

Allineamento a SR-LOG-01: il campo orario si chiama `ts` (decisione del coordinatore, salvo modifica del security-engineer). Il nome `timestamp` usato nella versione 1.0 di questo documento e superato.

### 2.4 Allowlist, redazione, errori

- **Allowlist (prima difesa)**: `formatters.log(obj)` copia solo le chiavi di `ALLOWED_FIELDS`. Le chiavi scartate non vengono mai scritte; si incrementa un contatore per istanza e si emette una sola riga `log.field_dropped` (warn) con il *nome* della chiave (non il valore), cosi il bug si vede in sviluppo e nel canary test senza perdere dati.
- **Valori**: le stringhe passano da `scrubString`: troncate a 200 caratteri, caratteri di controllo (CR, LF, TAB) sostituiti da spazio; pattern evidenti (email, sequenze `+` con 7-15 cifre, header `Bearer ...`) sostituiti con `[redacted]`. E una rete di sicurezza, non il meccanismo principale.
- **Redact di pino (seconda difesa)**, `censor: '[redacted]'`: `password`, `*.password`, `token`, `*.token`, `authorization`, `*.authorization`, `cookie`, `set-cookie`, `req.headers.*`, `*.smtp*`, `secret`, `*.secret`, `email`, `*.email`, `phone`, `*.phone`, `firstName`, `lastName`, `first_name`, `last_name`, `customer*`, `notes`, `body`, `*.body`. La lista e la sola in `redaction.ts` ed e confrontata nei test con SR-LOG-01.
- **Errori**: serializzatore `err` custom. Si registra `error_name`, `error_code` (codice `AppError` o SQLSTATE), nome del vincolo se SQL, e lo stack **senza la riga del messaggio** (solo frame `at ...`; i percorsi di file non sono PII). Il `message` di un'eccezione non-`AppError` non viene mai scritto (i driver DB possono includere `Key (email)=(...)` nel dettaglio). I messaggi di `AppError` sono costanti per costruzione.
- **Vietato** (CI): `console.*` (ESLint `no-console`), `logger.*` con template literal come primo argomento (`no-restricted-syntax`), import di `pino` fuori da `platform/logging`, passaggio di `req`, `headers`, `body`, `customer`, `booking` interi al logger (il tipo `LogFields` non li accetta).
- **Cosa non e mai nei log**: SR-LOG-02 per intero (password, token, session id, cookie, valori SMTP, chiavi, nomi/telefoni/email clienti, testo libero, body completi, IP interi, banner SMTP). URL: solo `route_template`, mai query string.

### 2.5 Livelli

| Livello | Uso | Produzione |
|---|---|---|
| `error` | richiede intervento: eccezione inattesa, `job.failed`, `pdf.failed`, `booking.failed`, `crypto.decrypt_failed` | si |
| `warn` | anomalia gestita: `booking.conflict`, `email.failed`, `ratelimit.exceeded`, `auth.login.failure` | si |
| `info` | eventi di business e ciclo di vita, riga di accesso `http.request` | si |
| `debug` | diagnosi locale | **rifiutato** dalla config se `APP_ENV` e `staging|production` (aggiungere la regola a `superRefine`, accanto alle guardie di 03b sez. 9) |

Un evento significativo = una riga ricca di contesto. Niente log nei cicli stretti: i job registrano una riga per tenant e una di riepilogo, non una per prenotazione.

### 2.6 Riga di accesso e rumore

Una riga `http.request` per richiesta (generata da `defineRoute`/`defineAction`/pagine): `route_template`, `method`, `status`, `duration_ms`, `outcome`. **Esclusi**: `/api/healthz`, `/api/readyz`, `/media/*` e `theme.css` di successo (volume alto, valore nullo). Gli `error` HTTP 5xx e i `warn` 4xx notevoli (403, 429) restano sempre.

---

## 3. Propagazione del correlation ID

Il `request_id` nasce una sola volta e viaggia in AsyncLocalStorage; ogni punto d'ingresso lo ristabilisce.

| Ingresso | Meccanismo |
|---|---|
| **Middleware** (`src/middleware.ts`, runtime edge) | Legge `x-request-id` in ingresso solo se rispetta `^[A-Za-z0-9._-]{8,64}$`, altrimenti genera un UUID v7 (`IdGenerator` non e disponibile su edge: usare `crypto.randomUUID()` e unica eccezione documentata alla regola 5 di 03b, da concordare con l'architect). Lo scrive negli header della richiesta inoltrata e della risposta. **Nessun log nel middleware** (edge, nessun ALS). Il valore e filtrato contro log injection e spoofing di formato. |
| **Server action** (`defineAction`) | Come primo passo legge `headers().get('x-request-id')`, costruisce `RequestContext { request_id, realm, tenant_id? , route_template }` e chiama `runWithContext`. `tenant_id` e `actor_id` si aggiungono con `withContext` appena risolti (risoluzione slug, guard). Il `request_id` e incluso nel risultato d'errore mostrato all'utente (SR-LOG-05). |
| **Route handler** (`defineRoute`) | Identico; la risposta ha `x-request-id`. `jobs/run` usa `bearerAuth(CRON_SECRET)` ma passa comunque da `defineRoute` quindi ha il contesto. |
| **Pagine RSC** | Non c'e un wrapper unico: `getRequestContext()` = store ALS se presente, altrimenti costruito da `headers()` e memoizzato con `React.cache`. I loader dei server component usano il logger ottenuto da li. |
| **Job** (`/api/jobs/run`, sidecar Compose, cron GitHub) | `realm='job'`. Il chiamante invia `x-request-id` (es. `gh-<run_id>`, `compose-<timestamp>`; passa il filtro del middleware). `JobRunner` apre un contesto per run e un `withContext({ tenant_id })` per ogni tenant; ogni riga `job_runs` e correlabile alle righe di log tramite `job` + `period_key` + `request_id`. |
| **`after()`** (invio email, PDF in background) | Il callback non eredita l'ALS in modo affidabile: si cattura `const ctx = captureContext()` prima e si rientra con `runWithContext(ctx, ...)` nel callback. Helper unico `afterWithContext(fn)` in `platform/http`; il lint vieta `after()` diretto fuori da li. |
| **Uscite** | SMTP/S3: nessuna propagazione di header. Si registra `email_log_id`/`entity_id` nella riga di log, cosi la riga `email_log` e la riga di log si collegano senza aggiungere colonne. Se OTel viene attivato: W3C `traceparent` su fetch in uscita, `trace_id` nel mixin. |
| **Errori all'utente** | Corpo generico con `request_id`; l'assistenza cerca `request_id` nei log (sezione 11). |

`onRequestError` (hook di `instrumentation.ts`, Next 15 o superiore, **da verificare sulla versione scelta**) e il paracadute per errori di render RSC e handler non gestiti: costruisce il contesto da `request.headers`, usa `context.routePath` (template, mai l'URL reale), logga `app.error.unhandled` e chiama `ErrorReporter.capture`. Copre SR-LOG-05 e ABU-M6-08.

---

## 4. Health e readiness

| Endpoint | Scopo | Comportamento | Note |
|---|---|---|---|
| `GET/HEAD /api/healthz` | liveness | 200 `{"status":"ok"}`. Nessun accesso a DB o rete. | `Cache-Control: no-store`; fuori da rate limit, access log e tenant routing; slug `api` e riservato (FR-PLT-07). |
| `GET/HEAD /api/readyz` | readiness | 200 `{"status":"ok"}` o 503 `{"status":"unavailable"}`. Controlli in ordine: (1) `SELECT 1` con timeout 1 s dal pool runtime; (2) migrazioni applicate: ultimo hash di `drizzle.__drizzle_migrations` uguale a quello incorporato nella build; (3) `current_user` diverso dal ruolo owner (03b sez. 9); (4) pool non esaurito (richieste in coda sotto soglia). | Il risultato positivo e messo in cache 5 s per istanza (nessun carico DB da pinger frequenti). Il corpo non contiene versioni, host, nomi di controlli. |

- Il motivo del fallimento va solo nel log: `readyz.failed` (warn) con `reason_code` in `db_unreachable | migrations_pending | role_invalid | pool_saturated`, limitato a una riga ogni 60 s per istanza.
- **Non** controllati in readiness: SMTP, S3, Sentry. Sono dipendenze con degradazione gestita (retry di `email_log`, storage per richiesta); un guasto SMTP non deve far uscire l'app dal bilanciatore. Si leggono da `email_log` (sezione 9).
- Uso: HEALTHCHECK del container e `restart` -> `healthz`; sonda di readiness della piattaforma e pinger esterno -> `readyz`; `depends_on: migrate: condition: service_completed_successfully` resta nel Compose (devops).
- Nessuna autenticazione: l'esposizione e minima per costruzione. Verifica in ABU: nessun header/corpo rivela versione o ambiente.

---

## 5. ErrorReporter

### 5.1 Port (`platform/error-reporter/port.ts`)

```ts
interface ErrorContext {
  event: EventName;                         // e.g. 'app.error.unhandled', 'job.failed'
  request_id?: string; tenant_id?: string; realm?: string;
  route_template?: string; severity?: 'error' | 'fatal';
  tags?: Record<string, string | number | boolean>;   // allowlisted keys only
}
interface ErrorReporter {
  capture(error: unknown, context: ErrorContext): void;  // never throws, never awaits network
  flush(timeoutMs: number): Promise<void>;               // serverless: awaited in after()/finally, max 2000 ms
}
```
Chi chiama: **solo** il gestore di ultima istanza di `defineAction`/`defineRoute`, `onRequestError`, `JobRunner` (per job fallito) e i callback `afterWithContext`. Gli errori attesi (`Result` negativo, `booking.conflict`) non si segnalano. Ogni `capture` e preceduto da una riga di log `error`: nulla dipende dal fornitore.

### 5.2 Adapter

| Adapter | Selezione | Comportamento |
|---|---|---|
| `noop` | `OBS_ERROR_REPORTER=noop` (default, obbligatorio in `local|ci`) | Non fa nulla. Il test container lo usa (`NoopErrorReporter`). |
| `sentry` | `OBS_ERROR_REPORTER=sentry` + `OBS_SENTRY_DSN` | SDK server-only (`@sentry/node` inizializzato in `instrumentation.ts`, runtime nodejs; **non** `@sentry/nextjs` con le sue auto-instrumentazioni, perche catturano body e URL). Funziona anche con GlitchTip (stessa SDK). Importato solo in `platform/error-reporter` (ban 1 di 03b). |
| `capturing` | solo test | Registra i payload gia scrubbati per il canary test. |

Configurazione Sentry (SR-LOG-08): `sendDefaultPii: false`; `defaultIntegrations: false` piu solo `linkedErrors` e gestione di `uncaughtException`/`unhandledRejection`; `maxBreadcrumbs: 0`; `tracesSampleRate: 0`; nessun replay, nessun profiling, nessun SDK browser; `sampleRate: 1`; `release` = `version` di build; `environment` = `APP_ENV`; `serverName` rimosso; regione UE scelta in fase di creazione dell'account (da confermare, vedi OBS-6).

`beforeSend` ricostruisce l'evento da una **allowlist** invece di rimuovere campi: tengono `exception.values[].type`, `value` sostituito dal solo `error_code` (o dal nome se manca), frame dello stack (`filename`, `function`, `lineno`), `level`, `release`, `environment`, tag consentiti (`request_id`, `tenant_id`, `realm`, `route_template`, `event`). Eliminati `request`, `user`, `contexts.device/os` con host, `extra`, `breadcrumbs`, `server_name`. Nessun `actor_id` (SR-LOG-08 vieta i dati utente; la correlazione si fa con `request_id`).

Controllo dei volumi: dedup per fingerprint (`error_name` + `error_code` + primo frame applicativo) e tetto di 50 eventi/ora per istanza (`OBS_SENTRY_RATE_CAP_PER_HOUR`); superato il tetto si logga una sola riga `error_reporter.rate_capped` per ora. Su serverless il tetto per istanza e debole: il limite reale e la quota gratuita, che scarta il surplus senza addebiti (verificato 2026-11-01 in `observability-options.md` 4.1).

Source map: non caricate nel baseline. Se si vuole leggere stack leggibili serve un token di CI e un upload non pubblico; decisione rinviata al go-live (sezione 12).

### 5.3 Aggiornamento riconciliato con ADR-0014
`OBS_LOG_SINK` previsto da ADR-0014: oggi vale solo `stdout`; il valore `otlp` e riservato per il futuro (V2/M2 di `observability-options.md`) e non e implementato in M0. Nessuna modifica all'ADR necessaria; se l'architect lo ritiene, una riga di errata.

---

## 6. Tassonomia degli eventi

Convenzione: `dominio.oggetto.azione` o `dominio.azione`, minuscolo con punti, nomi stabili (rinominare un evento e un cambiamento di contratto). Registro unico `platform/logging/events.ts` con livello, classe e campi attesi; un test verifica che ogni `logger.*` usi un evento registrato e che il registro non abbia duplicati.

**Classi**: **S** = evento di sicurezza: scritto in `security_event` (INSERT-only) **e** loggato con lo stesso nome (SR-LOG-03); **L** = solo log; **D** = log piu riga durevole in tabella di dominio.

### 6.1 Eventi di sicurezza (identici a SR-LOG-03)

| Evento | Livello | Classe | Campi / `reason_code` tipici | Note |
|---|---|---|---|---|
| `auth.login.success` | info | S | realm, actor_id, tenant_id? | |
| `auth.login.failure` | warn | S | realm, reason_code: `bad_credentials`, `account_locked`, `tenant_suspended`, `inactive`, `must_change_password` | account sconosciuto e password errata hanno lo stesso `reason_code` esterno (`bad_credentials`) |
| `auth.login.throttled` | warn | S | realm | rate limit del login |
| `auth.logout`, `auth.session.revoked`, `auth.password.changed` | info | S | actor_id | |
| `auth.token.issued`, `auth.token.redeemed`, `auth.token.rejected` | info / info / warn | S | reason_code: `expired`, `used`, `unknown`; mai il token | |
| `access.denied`, `tenant.mismatch`, `csrf.rejected` | warn | S | route_template, reason_code | |
| `ratelimit.exceeded` | warn | S | scope (`login`, `public_booking`...), ip_prefix, ip_hmac | alimenta la burst detection CSM-1 |
| `ssrf.blocked`, `upload.rejected` | warn | S | reason_code | |
| `job.auth_failed` | warn | S | ip_prefix, ip_hmac | Bearer errato su `/api/jobs/run` |
| `job.run` | info | S | job, period_key | una riga per invocazione autenticata dell'endpoint (non per job); il dettaglio e in `job_runs` |
| `crypto.decrypt_failed` | error | S | reason_code | possibile KEK errata o manomissione |
| `system.context.used` | info | S | scope (enum chiuso) | scritto da `withSystemTx`; volume alto: **in log solo a livello `debug`**, sempre in `security_event` |
| `export.created` | info | S | entity_type | |
| `tenant.hard_deleted` | info | S | | gia in `platform_audit` e `deletion_ledger` |
| `config.invalid` | error | S | nomi di variabile, mai valori | avvio fallito; scritto su DB solo se raggiungibile, altrimenti solo log |

Per ogni evento S il valore di `outcome`/`reason_code` e un codice, mai testo di eccezione. Regola di scrittura: la riga `security_event` e inserita nella stessa transazione dell'azione quando c'e una transazione; per i rifiuti (che non hanno transazione utile) in una transazione propria best-effort: se fallisce, resta la riga di log.

### 6.2 Eventi operativi e di business

| Evento | Livello | Classe | Campi chiave | Uso |
|---|---|---|---|---|
| `http.request` | info | L | route_template, method, status, duration_ms, outcome | SLI di latenza ed errori (se la retention lo consente) |
| `app.start` | info | L | version | conferma deploy |
| `app.error.unhandled` | error | L (+ReportError) | error_name, error_code, route_template | errori 5xx |
| `readyz.failed` | warn | L | reason_code | |
| `log.field_dropped`, `error_reporter.rate_capped` | warn | L | nome chiave / conteggio | igiene dell'osservabilita |
| `public.search` | info | L | tenant_id, count (risultati), duration_ms | NFR-OBS-01 |
| `public.vehicle_selected` | info | L | tenant_id, entity_id (vehicle) | funnel |
| `public.booking.submitted` | info | L | tenant_id | tentativo, denominatore dello SLI |
| `booking.created` | info | D (`bookings`) | tenant_id, entity_id (booking id), `source` come `outcome` | numeratore dello SLI |
| `booking.conflict` | warn | L | tenant_id, entity_id (vehicle) | esito di business valido, escluso dallo SLI |
| `booking.failed` | error | L | tenant_id, error_code | |
| `booking.edited`, `booking.cancelled` | info | D (`audit_log`) | tenant_id, entity_id | |
| `booking.status_changed` | info | L | tenant_id, count | dai job di transizione, aggregato per tenant |
| `email.queued` | info | D (`email_log`) | email_template, email_log_id | |
| `email.sent` | info | D | email_template, email_log_id, attempt | |
| `email.failed` | warn | D | email_template, email_log_id, attempt, reason_code (`smtp_timeout`, `smtp_auth`, `smtp_rejected`, `ssrf_blocked`, `not_configured`) | codice grossolano gia usato in `last_error` |
| `email.abandoned` | warn | D | email_log_id | oltre `max_attempts` o credenziale non consegnata |
| `pdf.generated` / `pdf.failed` | info / error | L | entity_id, duration_ms, error_code | |
| `job.started` / `job.finished` | info | D (`job_runs`) | job, period_key, attempt, processed, failed, duration_ms | |
| `job.failed` | error | D (`job_runs.status='failed'`) | job, period_key, error_code, tenant_id? | |
| `job.skipped` | info | D (`status='skipped'`) | job, period_key, reason_code (`already_done`) | idempotenza |
| `tenant.created`, `tenant.suspended`, `tenant.reactivated`, `tenant.terminated` | info | D (`platform_audit`) | tenant_id, actor_id | |
| `subscription.expired` (derivato dal job), `subscription.reminder_sent` | info | D | tenant_id, period_key | |
| `retention.purged` | info | L | job, count per categoria | esito di `purge_expired_records()` |
| `db.pool.error` | error | L | error_code | |

I nomi di Fase 3 `auth.login.succeeded` e `auth.lockout` non esistono piu (sostituiti rispettivamente da `auth.login.success` e da `auth.login.failure` con `reason_code=account_locked`). Gli eventi cliente non portano mai nome, telefono, email, note.

---

## 7. SLI senza alerting

Criticita bassa: sono **indicatori di rendicontazione con obiettivi indicativi**, riletti a mano (mensilmente e dopo ogni rilascio). Nessuna politica di error budget, nessun burn-rate. Se in futuro diventano SLO, si adotta la sezione 13.

Customer journey critici (due): **prenotazione pubblica** (ricerca, scelta, invio, conferma) e **accesso staff + gestione prenotazioni**. A questi si aggiungono due garanzie di funzionamento della piattaforma: **job eseguiti** e **email consegnate**.

| SLI | Definizione | Fonte durevole | Obiettivo indicativo | Disponibilita |
|---|---|---|---|---|
| Successo prenotazione pubblica | `booking.created(source=public)` / (`booking.created` + `booking.failed`); esclusi `booking.conflict` | log (`event`); in DB solo il numeratore | >= 99% | **dipende dalla retention dei log** |
| Disponibilita | risposte 200 di `readyz` / sonde | pinger esterno opzionale (OBS-3, ancora non attivato) | >= 99% mensile (circa 7 h) | non misurata finche non c'e un pinger |
| Latenza ricerca pubblica | p95 `duration_ms` di `http.request` per il template della ricerca | log | < 1,5 s | log |
| Latenza invio prenotazione | p95 idem per il submit | log | < 2 s | log |
| Tasso errori server | 5xx / richieste | log | < 1% | log |
| Consegna email | `sent` / (`sent` + `failed` + `abandoned`) su `email_log` nel periodo, solo `category='transactional'` | **DB** | >= 95% (SMTP del tenant fuori dal nostro controllo) | sempre |
| Freschezza job | eta dell'ultima riga `job_runs` con `status='succeeded'` per `job` | **DB** | job orario < 2 h, giornaliero < 26 h, snapshot annuale presente entro il 2 gennaio | sempre |
| Job falliti | righe `job_runs` con `status='failed'` e senza successivo `succeeded` per lo stesso `period_key` | **DB** | 0 | sempre |

**Limite onesto**: con retention dei log breve (Vercel Hobby 1 h, vedi `observability-options.md` 4.1) i primi cinque indicatori non sono calcolabili a posteriori. Le opzioni sono: sink con retention >= 7 giorni (Grafana Free via OTLP/drain, 14 giorni), oppure la tabella contatori opzionale `ops_counter` (domanda OBS-8). In assenza, si leggono "in diretta" solo gli ultimi minuti. Questo va dichiarato al GATE hosting.

Query di esempio per gli indicatori da DB (sezione 9). Per i log su un host con `docker compose logs`/`jq`:

```bash
# 5xx rate over the captured window
docker compose logs --no-log-prefix app | jq -c 'select(.event=="http.request")' \
 | jq -s '[.[]|select(.status>=500)]|length as $e | length as $n | {errors:$e, total:$n}'
# p95 for one route template
... | jq -s 'map(select(.route_template=="/[slug]/search").duration_ms)|sort|.[(length*0.95|floor)]'
```

---

## 8. Freschezza e registro dei job

`job_runs` (5.16) e la fonte unica. Protocollo gia definito: una riga per `(job, tenant_id, period_key)`, nessuno stato `running`, upsert `ON CONFLICT` in transazione, retention 12 mesi. L'osservabilita aggiunge:

1. **Atteso vs reale**: il registro dei job (`registerJob`) dichiara per ogni job la `cadence` (`hourly`, `daily`, `yearly`, `event`) e `maxAgeMinutes`. La pagina di stato (sezione 9) confronta `now() - max(finished_at) FILTER (WHERE status='succeeded')` con `maxAgeMinutes`; il registro e dati statici nel codice, non una tabella.
2. **Un job che non e mai partito non lascia righe**: per questo la freschezza si calcola contro il registro, non contro la tabella; la pagina mostra `mai eseguito` come stato di errore.
3. **Esecuzione pigra** (ADR-0007): se la valutazione e lazy (es. ricavi calcolati su prenotazioni effettivamente completate), il job in ritardo non rompe i dati; la freschezza resta un indicatore per l'operatore, non per l'utente.
4. **Log**: `job.started`, `job.finished`/`job.failed` e `job.skipped` come in 6.2; `error` nella riga durevole e il codice ripulito (<= 500 caratteri, SR-LOG-02).
5. **Trigger non riuscito** (scheduler esterno che non chiama): invisibile alla tabella. Con CSM-1 si copre con un heartbeat (sezione 13). Fino ad allora: la pagina KPI mostra l'orario dell'ultimo `job.run` autenticato (da `security_event`).
6. Il backup del database non e un job dell'applicazione: la sua riuscita si vede nel pannello dell'host/nel workflow `nightly-backup.yml`. La pagina di stato mostra un campo manuale non previsto; si lascia al runbook devops (sezione 12).

---

## 9. Pagina "Stato piattaforma" del systemadmin (KPI-7, NFR-OBS-02/03)

Percorso: `/system/status` (console, ruolo systemadmin, `Cache-Control: no-store`). Sola lettura, tutte le query in `withSystemTx('system')`, nessun dato personale. Rispetta la decisione del coordinatore: **solo conteggi per tenant, nessun ricavo** (DB-A7). Se i ricavi saranno confermati, si estende `platform_kpis`.

| Sezione | Contenuto | Query / fonte |
|---|---|---|
| A. Job | Per job: ultimo successo, eta, stato rispetto a `maxAgeMinutes`, ultimo fallimento con `error`, tentativi | Q1 |
| B. Email | Ultimi 7/30 giorni: totale, `sent`, `failed`, `abandoned`, tasso di consegna; per template; mail di credenziali non consegnate | Q2 / Q2b (funzioni `platform_email_health`, `platform_undelivered_credentials`) |
| C. Prenotazioni | Per tenant, mese corrente e precedente: create, completate | `platform_kpis(p_from, p_to)` (esiste, definer, richiede scope `system`) |
| D. Sicurezza (sola lettura, per CSM-1) | Ultime 24 h per evento: `auth.login.failure`, `ratelimit.exceeded`, `access.denied`, `job.auth_failed`, `crypto.decrypt_failed`; ultimo `auth.login.success` del systemadmin | Q3 |
| E. Tenant | Conteggio per stato (`active`, `suspended`, `terminated`); abbonamenti in scadenza entro 14 giorni | su `tenants`, `subscriptions` |
| F. Versione | `version` di build, `APP_ENV`, stato `readyz` interno | codice |

Query indicative (nomi di colonna da `05-database.md`; il backend le implementa come funzioni definer o viste in scope `system`; `job_runs` e leggibile cross-tenant dallo scope `system` (query dirette Q1/Q1b); `email_log` no: Q2/Q2b usano `platform_email_health(p_since)` e `platform_undelivered_credentials(p_since)` (`docs/05-database.md` v1.1, 4.6)):

```sql
-- Q1 job freshness (registry rows are passed in as a VALUES list from code: job, max_age_minutes)
SELECT r.job,
       max(j.finished_at) FILTER (WHERE j.status = 'succeeded')       AS last_success_at,
       max(j.finished_at) FILTER (WHERE j.status = 'failed')          AS last_failure_at,
       (now() - max(j.finished_at) FILTER (WHERE j.status = 'succeeded')) > make_interval(mins => r.max_age_minutes)
         OR max(j.finished_at) FILTER (WHERE j.status = 'succeeded') IS NULL AS is_stale
FROM (VALUES ($1::text, $2::int) /* repeated per registered job */) AS r(job, max_age_minutes)
LEFT JOIN job_runs j ON j.job = r.job AND j.started_at > now() - interval '60 days'
GROUP BY r.job, r.max_age_minutes;

-- Q1b unresolved failures (failed with no later success for the same key)
SELECT job, tenant_id, period_key, attempt, finished_at, error
FROM job_runs
WHERE status = 'failed' AND finished_at > now() - interval '30 days';   -- the unique index keeps one row per key,
                                                                        -- a retry that succeeds updates the same row

-- Q2 email delivery: scope 'system' has NO row access to email_log (docs/05-database.md v1.1, 4.5/4.6).
-- Use the aggregate definer function (requires app_scope() = 'system'; no recipient, no tenant id):
SELECT category, template, status, count
FROM platform_email_health($1::timestamptz);          -- $1 = now() - interval '30 days'
-- delivery rate computed by the caller on category = 'transactional':
--   sent / nullif(sent + failed + abandoned, 0)

-- Q2b credential mails not delivered (activation not delivered; the admin re-issues the link)
SELECT tenant_id, related_id, last_attempt_at
FROM platform_undelivered_credentials($1::timestamptz);   -- $1 = now() - interval '14 days'

-- Q3 security signals (last 24 h)
SELECT event, outcome, count(*) FROM security_event
WHERE created_at > now() - interval '24 hours'
  AND event IN ('auth.login.failure','auth.login.throttled','ratelimit.exceeded','access.denied',
                'job.auth_failed','crypto.decrypt_failed','csrf.rejected','tenant.mismatch')
GROUP BY event, outcome ORDER BY count(*) DESC;
```
Poiche `job_runs` ha una riga per chiave e il retry aggiorna la stessa riga (`ON CONFLICT ... WHERE status='failed'`), Q1b elenca i fallimenti ancora aperti senza join aggiuntivi. Indici: `job_runs` ha il solo indice univoco; per Q1 basta (poche migliaia di righe/anno); `email_log(created_at)` esiste. Nessun indice nuovo richiesto a questa scala.

La pagina e il sostituto dell'alert: ogni sezione mostra un semaforo testuale (ok / da controllare / errore, non solo colore: A11Y) con le soglie del registro. Testi nel catalogo i18n, nomi di evento e colonne in inglese.

---

## 10. Esperienza di sviluppo locale

- **Default Compose**: log JSON su stdout, rotazione `json-file` `max-size: 10m`, `max-file: 3` (devops).
- **Pretty log**: `OBS_LOG_PRETTY=true` ammesso solo con `APP_ENV=local`. Implementazione: in `createLogger`, se il flag e attivo, importazione dinamica di `pino-pretty` (devDependency) e uso come **stream sincrono** in-process (`pino(opts, pretty(...))`), senza `pino.transport` (che crea un worker thread e non funziona bene in serverless/standalone). Config valida solo in local; in altri ambienti il flag e rifiutato dalla config.
- `pnpm dev` imposta `OBS_LOG_PRETTY=true` e `OBS_LOG_LEVEL=debug`; `compose.yaml` lascia JSON. Script `pnpm logs` = `docker compose logs -f --no-log-prefix app | pnpm exec pino-pretty` per leggere in modo umano i log del container.
- **Filtri utili** documentati nel README di sviluppo: per request id `... | jq 'select(.request_id=="<id>")'`; per tenant; per evento; per errori.
- `OBS_ERROR_REPORTER=noop` in locale; per provare Sentry/GlitchTip, profilo opzionale `observability` (devops, `observability-options.md` L2).
- Il riga `app.start` e `config.invalid` rendono evidente un avvio fallito in `docker compose up`.
- Mailpit (profilo gia previsto) mostra le email; `email_log` mostra l'esito: insieme coprono il debug dell'invio senza SMTP reale.

---

## 11. Test e verifica (per qa-engineer; coordinamento con ABU-M0-15, ABU-M6-08)

1. **Unit del logger** (`tests/unit/platform/logging`): oggetto con chiavi proibite -> assenti; chiave non in allowlist -> scartata + una riga `log.field_dropped`; CR/LF nei valori neutralizzati; errore con messaggio contenente una email -> il messaggio non compare; ogni evento del registro ha livello e classe; nessun evento duplicato.
2. **Canary test** (`tests/security/log-canary.test.ts`, gate di merge dal M0): costruisce il container di test con `CapturingLogSink`, `capturing` ErrorReporter e DB di test; esegue gli scenari ABU-M0-15 (prenotazione con `CANARY_NAME_7f3a`, login fallito con `CANARY_PASS_...`, salvataggio SMTP con `CANARY_SMTP_...`, upload, impostazione password con `CANARY_TOKEN_...`) piu: eccezione forzata con messaggio che include un canary, errore SQL con `Key (...)=(canary)`, `after()` che fallisce. Poi scansiona: stdout/stderr catturati, righe di log, payload dell'error reporter, e le tabelle `email_log`, `job_runs`, `audit_log`, `security_event`, `platform_audit`. Zero occorrenze dei sentinella.
3. **Test del payload Sentry con SDK reale**: `Sentry.init` con un `transport` finto che registra le buste; l'evento in uscita deve contenere solo i campi dell'allowlist di 5.2 (prova che `beforeSend` e la configurazione sono davvero attivi, non solo la nostra funzione).
4. **Lint/architettura**: `no-console`, ban template literal nei log, `pino` e `@sentry/*` solo nei loro adapter (gia ban 1), `after()` solo tramite `afterWithContext`, ogni route/action costruita con `defineRoute`/`defineAction` (gia regola Semgrep).
5. **Correlazione**: test d'integrazione che invia `x-request-id: test-0001` a una action, a un route handler e a `/api/jobs/run`, e verifica la stessa `request_id` su tutte le righe prodotte, inclusa quella dentro `after()`; richiesta con id non valido -> id nuovo; risposta con header `x-request-id`.
6. **Health**: `healthz` risponde 200 con DB spento; `readyz` 503 con DB spento, con migrazione mancante e con ruolo owner; corpi identici e privi di dettagli; nessuna riga di log per le sonde riuscite.
7. **Job**: il registro dichiara cadence per ogni job (test iterativo come SR-AUD-01); `job_runs` ha una riga per run; la query Q1 segnala `is_stale` con orologio finto avanzato.
8. **Fault injection (ABU-M6-08)**: DB giu, Zod, eccezione in action/handler/RSC, eccezione SMTP -> corpo generico con `request_id`, riga `app.error.unhandled`, una sola `capture`.
9. **Verifica su staging prima del GATE 4** (modalita verifica): ricerca per `request_id` nei log dell'host reale, pagina `/system/status` popolata, un errore provocato arriva a Sentry (se attivo) senza PII, i log dell'host hanno retention <= 30 giorni (SR-LOG-06). Nessun alert da provare: non esistono (RK-10); **se CSM-1 e approvata, la verifica deve includere che ogni alert scatta e arriva**.

---

## 12. Cosa attivare per host al go-live

L'hosting e rinviato; la tabella si applica quando sara scelto. Costo osservabilita: 0 EUR in tutti i casi (limiti verificati 2026-11-01 in `observability-options.md` 4.1, da ricontrollare all'adozione).

| Voce | Docker locale | Vercel + Postgres UE | VPS UE con Docker | Piattaforma container UE |
|---|---|---|---|---|
| Log JSON stdout | si | si (runtime logs 1 h Hobby / 1 giorno Pro) | si, rotazione json-file, retention <= 30 gg | si, retention da verificare |
| Retention log <= 30 gg (SR-LOG-06) | rotazione | default piattaforma (dichiarare nell'informativa) | da configurare | da verificare |
| `OBS_ERROR_REPORTER` | `noop` | `sentry` (Developer free, regione UE) | `sentry` oppure GlitchTip self-hosted | `sentry` |
| Sink con >= 7 gg per SLI su log | no | solo se Grafana Cloud Free via OTLP (non implementato in M0) | `docker logs` + rotazione 30 gg | da verificare |
| Sonda `readyz` | Compose healthcheck su `healthz` | sonda esterna (OBS-3) | Uptime Kuma o pinger esterno | probe di piattaforma + pinger |
| `/system/status` | si | si | si | si |
| Registrazione sub-responsabile nell'informativa | n/a | Vercel (host) e Sentry | Sentry (o nessuno con GlitchTip) | piattaforma e Sentry |
| Cron per `/api/jobs/run` | sidecar | GitHub Actions / Vercel Cron | sidecar o cron host | scheduler piattaforma o GitHub |
| Source map | no | opzionale (token CI) | opzionale | opzionale |
| Quota Sentry | n/a | tetto 50 ev/h/istanza | idem | idem |

Da dichiarare al GATE hosting: se la scelta e Vercel Hobby, l'uso commerciale non e consentito (vedi OBS-2 di Fase 3) e la retention di 1 h rende gli SLI su log non calcolabili.

Controlli di go-live per l'osservabilita (alimentano la checklist del release-manager): canary test verde su CI; `readyz` verificato su staging; account Sentry/GlitchTip con regione UE e DSN come segreto; retention log verificata sul pannello dell'host; `/system/status` mostra tutti i job con stato ok; runbook "come indagare" (sotto) nel README operativo.

**Runbook minimo "come indagare" (da riportare nel runbook devops, inglese)**: 1) prendere `request_id` dal messaggio d'errore dell'utente; 2) cercarlo nei log (`jq`/viewer host); 3) se manca il log, guardare `/system/status` sezioni A e B; 4) per sospetti di sicurezza, sezione D e le query SR-GDPR-10; 5) se l'host e giu, controllare il pannello del fornitore (nessun alert lo segnalera).

---

## 13. Piano futuro di alerting (non attivo; allineato a CSM-1)

Nessuna implementazione ora (G27, RK-10). Il baseline non lo ostacola: nomi di evento stabili, `request_id`, `job_runs`, `readyz`, provider via env, nessun SDK fuori dall'adapter.

**Opzione CSM-1 "email minime"** (proposta, in attesa di decisione prima del GATE 4). Quattro segnali, tutti gia emessi dal codice (SR-LOG-03), tutti su canali gratuiti, un solo destinatario (il titolare), orario non garantito (best effort, nessuna reperibilita):

| Segnale | Condizione | Come, a costo 0 | Dove |
|---|---|---|---|
| Sito non risponde | `readyz` non 200 per 2 sonde consecutive (5 min) | pinger esterno gratuito (UptimeRobot / Better Stack free / Uptime Kuma) con email | esterno all'app |
| Job non eseguito/fallito | nessun `succeeded` nelle ultime 26 h (giornalieri) o 2 h (orari), oppure `status='failed'` aperto | **heartbeat**: a fine run riuscito il runner fa una GET a un URL di heartbeat (`OBS_HEARTBEAT_URL`, vuoto = disattivato; adapter `HeartbeatNotifier` con timeout 2 s); il servizio avvisa se manca. In alternativa Sentry cron monitor. | adapter nuovo, nessun SDK |
| Raffica di login falliti / nuovo accesso systemadmin | > N `auth.login.failure` o `auth.login.throttled` in 10 min; ogni `auth.login.success` realm `system` | job orario in-app che legge `security_event` e invia **un'email di riepilogo dal mailer di sistema** a `SYSTEM_ADMIN_EMAIL`, con deduplica per finestra (idempotente come gli altri job; riga in `job_runs`) | job `ops.security_digest` |
| Raffica di rate limit / backup | `ratelimit.exceeded` oltre soglia; backup non riuscito | rate limit: stesso digest; backup: notifica nativa del workflow GitHub / del provider DB | digest / host |

Valutazione: costo 0 EUR, sforzo stimato ~1-2 giorni di sviluppo per heartbeat + digest + test, nessuna reperibilita e nessuna garanzia di orario (se l'app e giu il digest non parte: per questo il pinger e esterno). **Raccomandazione: attivare almeno il pinger esterno e l'heartbeat dei job prima del GATE 4** (mitigano i due guasti silenziosi piu probabili, JB-06 e sito fermo), il digest di sicurezza come seconda fase. La decisione e di CSM-1 / dell'utente: domanda OBS-7.

**Se in futuro serviranno alert veri** (primo cliente pagante o SLA): promuovere gli SLI della sezione 7 a SLO (99% successo prenotazione, 99% disponibilita), error budget mensile e burn rate multi-finestra (per 99%: 6x su 1 h e 3x su 6 h; ricalcolare con la finestra scelta); severita P1/P2/P3 con soglie motivate, runbook linkato per ogni alert, canale di incidente, status page, post-mortem senza colpevoli; OpenTelemetry (HTTP, query DB, SMTP/S3) con campionamento 100% errori e 10% resto verso Grafana Cloud Free; RUM/error tracking frontend solo dopo consenso (oggi escluso). Trigger e costi: tabella in `observability-options.md` sezione 7.

---

## 14. Note per i colleghi in parallelo

- **backend-developer**: implementare `platform/logging`, `platform/error-reporter`, `platform/http` (contesto, `afterWithContext`), registro eventi, `/api/healthz`, `/api/readyz`, `onRequestError`; allineare `OBS_*` e il nome `ERROR_REPORTER`; registro job con `cadence` e `maxAgeMinutes`; le funzioni/viste della sezione 9.
- **devops-engineer**: rotazione log nel Compose, healthcheck su `healthz`, `depends_on` migrate, variabili `OBS_*` e DSN come segreto, retention log dell'host, pinger esterno se CSM-1 approvata, `nightly-backup.yml` con notifica di fallimento, secret `OBS_HEARTBEAT_URL` opzionale.
- **qa-engineer**: sezione 11 come piano; `CapturingLogSink` e `capturing` reporter nel test container; il canary test e gate di merge dal M0.
- **database-architect**: gia recepito in `05-database.md` v1.1 (`job_runs` leggibile, `email_log` solo via funzioni aggregate); `job_runs.error` e `email_log.last_error` solo codici.
- **security-engineer**: confermare lista di redazione (2.4), `system.context.used` in log solo a debug, wording del sub-responsabile.

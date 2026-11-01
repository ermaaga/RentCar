# Requirements: RentCar (multi-tenant car rental SaaS)

Version 1.1 · 2026-11-01 · Owner: requirements-analyst · Status: draft for GATE 1 (all REQ-1..REQ-16 questions answered by the user and integrated)
Sources: `docs/spec/car-rental-spec.md` (primary), `docs/01-discovery.md`, `docs/00-stato-progetto.md`, `docs/pm/raid.md`, user answers to REQ-1..REQ-16 (2026-11-01).
Language: English (decision 2026-11-01). Spec section references are written `§n`; spec acceptance criteria `AC1`..`AC11`.

Conventions: priority uses MoSCoW (M/S/C/W). `A-nn` = assumption made by the analyst, to be confirmed (section 9). `REQ-n` = decision already taken by the user (section 10). No technology is chosen here beyond what spec §2 already fixes.

Change log v1.1: day count by calendar days; automatic status transitions with manual override; revenue from completed bookings only (by return date); closed years correctable with versioned snapshots; 7-day grace on expiry; all extras in scope (admin new-booking email, owner emails, CSV exports, audit log); bookings fully editable by the admin; one admin per tenant with systemadmin recovery. Assumption numbering was rebuilt from scratch (A-1..A-39) and every reference re-checked.

---

## 1. Context and objectives

**Problem.** Small and medium car rental businesses lack a simple tool to publish a booking page, avoid double bookings, and understand fleet profitability. The software owner (systemadmin) offers this as a SaaS to many independent businesses (tenants), managing subscriptions manually.

**Business objective.** A multi-tenant platform where each tenant has a branded public booking site (`/{slug}`), an admin area (`/{slug}/admin`), and the owner has a platform console (`/system`).

**Success metrics.**

| ID | Metric | Target |
|---|---|---|
| KPI-1 | Systemadmin onboards a tenant (tenant + subscription + admin email sent) | <= 10 minutes, no developer help |
| KPI-2 | Customer completes a booking on a 375px phone | <= 2 minutes, <= 4 screens (search, results, form, confirmation) |
| KPI-3 | Double bookings of the same vehicle for overlapping periods | 0, including under concurrent requests and edits |
| KPI-4 | Per-vehicle and global revenue/expense/net by month and year match entered data | 100% reconciliation (automated test) |
| KPI-5 | Cross-tenant data leaks | 0 (automated cross-tenant tests in CI) |
| KPI-6 | Fresh clone runs with `docker compose up` | 1 command, migrations automatic (AC1) |
| KPI-7 | Owner can see business KPIs without alerting: bookings per tenant, revenue per tenant | Visible in views / logs |

---

## 2. Actors, roles and permissions

| Actor | Scope | Authentication |
|---|---|---|
| Anonymous customer | Public site of one tenant | None |
| operator | One tenant | username + password |
| admin | One tenant (exactly one admin per tenant, REQ-16) | username + password |
| systemadmin | Platform (`/system`) | username + password, separate from tenant accounts |
| System (scheduled jobs) | Platform | n/a (status transitions, year-end snapshots, subscription expiry marking and emails, yearly privacy reminder) |

**Permission matrix** (Y allowed, V view only, N no).

| Action | Customer | operator | admin | systemadmin |
|---|---|---|---|---|
| Search availability, create booking (public) | Y | N | N | N |
| View calendar | N | Y | Y | N |
| View bookings (list/detail, with customer contacts) | N | V | Y | N |
| Create / edit / cancel booking, mark payment, change status | N | N | Y | N |
| View vehicles (no expenses) | N | V | Y | N |
| Create / edit / archive vehicles, photos, maintenance toggle | N | N | Y | N |
| Expenses (view / create / edit / delete) | N | N | Y | N |
| Customer list, detail, anonymise, export | N | N | Y | N |
| Revenue, yearly archive | N | N | Y | N |
| CSV exports (bookings, customers, revenue) | N | N | Y | N |
| Audit log (tenant events) | N | N | Y | N |
| Create / deactivate operators | N | N | Y | N |
| Branding, booking rules, privacy notice, tenant SMTP | N | N | Y | N |
| Change own password | N | Y | Y | Y |
| Create/edit/suspend tenants, subscriptions | N | N | N | Y |
| Create, reset or replace the tenant admin | N | N | N | Y |
| View tenant/subscription audit events | N | N | N | Y |
| View a tenant's bookings and customers | N | N | N | N (A-13) |

---

## 3. Scope

### 3.1 In scope
All modules in section 4: auth, systemadmin console, public booking, calendar, vehicles and expenses, bookings (including full edit), customers, operators, revenue and versioned yearly snapshots, branding/settings, email and PDF, audit log, CSV exports, owner/admin notifications, responsive and visual design, platform requirements (Docker Compose, seed, pluggability, tenant resolution, serverless compatibility). Delivery in milestones, no fixed deadline (discovery A4, B8).

### 3.2 Suggested milestone order (input for the plan, not binding)
M1 platform + auth + systemadmin + tenants/subscriptions (AC1, AC2) · M2 vehicles + public booking + email/PDF + availability (AC3, AC4) · M3 admin bookings (incl. edit) + calendar + customers + operators + audit log (AC5, AC8) · M4 expenses + revenue + snapshots + CSV (AC6, AC7) · M5 branding + visual design + responsive hardening (AC9, AC11) · M6 pluggability proof + notifications + hardening (AC10).

### 3.3 Out of scope (explicit)
- Online payment, deposits, refund processing, invoices, receipts, e-invoicing, VAT breakdown (REQ-13). The PDF is a booking summary, not a fiscal document.
- OTP, biometric login, SSO (extension point only, FR-AUTH-12).
- Promotions and discounts (extension point only: pricing function, FR-PUB-12).
- Customer self-service: no online cancellation, no booking lookup by code (REQ-6).
- CAPTCHA, SMS/email verification of customers (REQ-7).
- Opening hours for pickup/return (REQ-8).
- Drag and drop in the calendar.
- Vehicle mileage and document expiry dates (spec §7.2 "later").
- Maintenance with date ranges (REQ-9: a simple toggle only).
- Multiple admins per tenant (REQ-16).
- Multiple UI languages; native apps; offline mode.
- Custom domains per tenant (design for it only: FR-PLT-04).
- Delivery address, one-way rentals, extras, multiple locations.
- Alerting, on-call, status page (discovery G27, G31).
- Charts in revenue (optional, Could; tables required).
- Customer accounts / login for customers.
- Hard deletion of tenants from the UI (A-15).
- SMS, WhatsApp or push notifications.

---

## 4. Epics, functional requirements and user stories

### EP-01 Authentication and account lifecycle (§4)

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-AUTH-01 | Login with username + password for operator/admin at `/{slug}/admin/login`; usernames unique within a tenant (A-1). | M | §4 |
| FR-AUTH-02 | Separate systemadmin login at `/system/login`; systemadmin accounts have no tenant. | M | §4, §8 |
| FR-AUTH-03 | On creation of an admin/operator the system generates a random temporary password and emails it; account has `mustChangePassword = true`. | M | §4 |
| FR-AUTH-04 | A user with `mustChangePassword` can access nothing but the change-password screen until changed. | M | §4 |
| FR-AUTH-05 | Password reset request for operator/admin sends a single-use, time-limited link through the tenant SMTP; for systemadmin through the system SMTP. | M | §4 |
| FR-AUTH-06 | Reset response is identical whether or not the account exists (no enumeration). | M | §4 |
| FR-AUTH-07 | Password policy: min 10 characters, not equal to username, not in a common-password list (A-2). | M | §10 |
| FR-AUTH-08 | Login throttling per account and per IP (A-3). | M | §10 |
| FR-AUTH-09 | Server-validated session with inactivity and absolute expiry; logout invalidates it (A-4). | M | §3 |
| FR-AUTH-10 | A deactivated user cannot log in; existing sessions stop working. | M | §9 |
| FR-AUTH-11 | Temporary password valid 7 days, reset link 60 minutes (A-2); admin (for operators) or systemadmin (for the admin) can regenerate a temporary password. | S | §4 |
| FR-AUTH-12 | Auth module exposes a documented extension point for additional factors (OTP/biometrics), not implemented. | M | §4 |
| FR-AUTH-13 | Every request to tenant routes is authorised by role and tenant. | M | §10 |

**US-001 Admin first login** (M · FR-AUTH-03/04)
- Given a new admin with a temporary password, When I log in with it, Then I am redirected to change-password and cannot open any other page.
- Given a valid new password, When I submit, Then `mustChangePassword` is cleared and I land on the admin home.
- Given a password violating the policy, When I submit, Then I see which rule failed and nothing changes.

**US-002 Password reset** (M · FR-AUTH-05/06)
- Given a registered account, When I request a reset, Then an email is sent through the tenant SMTP (operator/admin) or system SMTP (systemadmin) with a link valid 60 minutes, single use.
- Given an unknown username/email, When I request, Then I see the same confirmation and no email is sent.
- Given an expired or used link, When opened, Then I can request a new one.
- Given the tenant SMTP is missing or fails, When an operator requests a reset, Then the user sees the generic confirmation, the failure is logged and shown to the admin (A-10).

**US-003 Login protection** (M · FR-AUTH-08/10)
- Given 5 failed logins in 15 minutes (A-3), When another attempt is made, Then it is delayed/blocked and the message does not reveal whether the username exists.
- Given a deactivated user, When correct credentials are entered, Then login fails with the generic message.

**US-004 Role enforcement** (M · FR-AUTH-13)
- Given an operator session, When any write request is sent to an admin API, Then 403 and nothing changes (AC8).
- Given an admin of tenant A, When requesting a resource id of tenant B, Then not-found/forbidden and no data disclosed (NFR-ISO-01).

### EP-02 Systemadmin console: tenants and subscriptions (§5, §8)

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-SYS-01 | List tenants (name, slug, status, subscription state, end date, vehicle/operator counts) with search and pagination. | M | §8 |
| FR-SYS-02 | Create tenant: name, slug, contact info, title, status, time zone (default Europe/Rome), currency (default EUR). Slug unique, URL-safe, not reserved, immutable (A-5). | M | §5 |
| FR-SYS-03 | Edit tenant data, logo, colors, SMTP config (password encrypted, never shown again). | M | §4, §5 |
| FR-SYS-04 | Suspend and reactivate a tenant (effect: FR-SYS-12). | M | §4, §5 |
| FR-SYS-05 | Create subscription: maxVehicles, maxOperators, startDate, endDate, price, currency, status. | M | §5 |
| FR-SYS-06 | Edit and renew a subscription at any time; one current subscription per tenant (A-6). | M | §5 |
| FR-SYS-07 | Subscription states: `active`, `expired`, `cancelled`. `expired` is derived when the end of endDate (tenant time zone) has passed. After expiry the tenant is in a 7-day **grace period** (derived, not stored), then read-only (REQ-5, FR-SYS-13). `cancelled` is set manually and has no grace (A-8). | M | §5 |
| FR-SYS-08 | Limit enforcement: adding a vehicle or active operator beyond the limit is rejected with a clear message naming the limit and usage. Lowering a limit below current usage deletes nothing; it only blocks additions. | M | §5 |
| FR-SYS-09 | Create the first admin of a new tenant (name, username, email); temporary password emailed through the system SMTP. | M | §8 |
| FR-SYS-10 | "Send test email" using a tenant's SMTP config. | S | §5 |
| FR-SYS-11 | Subscription price/currency are informational and independent from the tenant currency (A-14). | M | §5 |
| FR-SYS-12 | **Suspended tenant** (REQ-5, A-7): effective immediately, no grace. Public site shows a neutral "temporarily unavailable" page; admin/operator login rejected with a clear message and existing sessions invalidated; data retained; systemadmin unaffected. | M | §4 |
| FR-SYS-13 | **Expired subscription** (REQ-5): during the 7-day grace period everything works normally (public site bookable, admin writable) and the admin sees a renewal banner (shown from 14 days before endDate through grace, A-8). After grace the tenant becomes read-only: the public site shows "bookings unavailable" and does not accept new bookings; staff can view everything; **existing bookings remain valid**; the operations in FR-ENF-01 stay allowed. Renewal lifts read-only immediately. | M | §5 |
| FR-SYS-14 | Owner emails to `SYSTEM_ADMIN_EMAIL` via the system SMTP: on tenant creation, and 14 days before a subscription ends (once per subscription period, idempotent). Also sent to the tenant admin (renewal reminder, same moment). | M | §2, §3, REQ-14 |
| FR-SYS-15 | **Admin access recovery** (REQ-16): systemadmin can reset the tenant admin's password (new temporary password via system SMTP) or replace the admin (create a new admin and deactivate the old one: same tenant, one active admin at all times). The action is audit-logged and invalidates the old admin's sessions. | M | §8, REQ-16 |
| FR-ENF-01 | Read-only enforcement is one central policy. In read-only (expired after grace, or cancelled subscription) all state-changing admin operations are rejected with an explanatory message and disabled in the UI, **except**: login, change own password, password reset, logout, recording payments on existing bookings, and status updates of existing bookings (automatic transitions, manual active/completed, and cancellation) (A-9). Not allowed: creating or editing bookings (dates/vehicle), vehicles, expenses, operators, settings, branding. | M | §5 |

**US-010 Create tenant with subscription** (M · FR-SYS-02/05/09 · AC2)
- Given valid data, When I save the tenant, subscription and first admin, Then the tenant is reachable at `/{slug}`, the admin receives a temporary password via the system SMTP, and the owner receives the "tenant created" email.
- Given a slug in use or reserved, When I save, Then a validation error appears and nothing is created.
- Given the email cannot be sent, When creation completes, Then the tenant exists, I am told the email failed, and I can regenerate and resend the password.
- Given a double submit, Then only one tenant/admin is created.

**US-011 Suspend / reactivate tenant** (M · FR-SYS-04/12)
- Given an active tenant, When I suspend it, Then immediately the public page shows the unavailable message, admin logins fail with a clear message, sessions are rejected, and data remains. There is no grace period.
- Given a suspended tenant, When I reactivate it, Then behaviour follows its subscription state.

**US-012 Edit and renew subscription** (M · FR-SYS-06/07)
- Given an expired subscription, When I extend endDate to a future date, Then the tenant leaves grace/read-only immediately.
- Given overlapping periods, When I create a second current subscription, Then the system prevents it (A-6).

**US-013 Limits enforced** (M · FR-SYS-08)
- Given a tenant at maxVehicles, When the admin adds a vehicle, Then it is rejected with "Vehicle limit reached (n of n)".
- Given maxOperators reached, Then creating an operator is rejected; deactivated operators do not count.
- Given two concurrent creations at limit-1, Then at most one succeeds.

**US-014 Grace period and read-only after expiry** (M · FR-SYS-13, FR-ENF-01)
- Given a subscription that ended 3 days ago, When a customer opens `/{slug}`, Then search and booking work, and the admin sees a renewal banner.
- Given a subscription that ended 8 days ago, When a customer opens `/{slug}`, Then a "bookings unavailable" message appears and no search form is shown; confirmed bookings made earlier remain valid.
- Given the same state, When the admin opens lists and details, Then data is viewable and create/edit actions are disabled with a reason; a direct API write to those returns 403 "subscription expired".
- Given the same state, When the admin marks an existing booking paid or completes/cancels it, Then it succeeds (A-9).
- Given the subscription is cancelled, Then there is no grace: read-only applies immediately (A-8).

**US-015 Configure tenant SMTP** (M · FR-SYS-03, FR-BRD-06)
- Given SMTP settings saved, When the form is reopened, Then the password is blank/masked and never returned by any API.
- Given "Send test email", When pressed, Then success or the SMTP error summary (no secrets) is shown.

**US-016 Recover tenant admin access** (M · FR-SYS-15)
- Given a tenant admin who lost access and email, When the systemadmin replaces the admin with a new person, Then the new admin gets a temporary password via system SMTP, the old admin is deactivated and cannot log in, and there is never more than one active admin.
- Given a reset on the same admin, Then the old password and sessions stop working and the action appears in the audit log.

**US-017 Owner notifications** (M · FR-SYS-14)
- Given a subscription ending in 14 days, When the daily job runs, Then the owner and the tenant admin each receive one email; running the job again sends no duplicates.

### EP-03 Public booking flow (§6)

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-PUB-01 | Public tenant page at `/{slug}` resolved through the single tenant-resolution function (FR-PLT-04); unknown slug returns a generic 404. | M | §6 |
| FR-PUB-02 | Search form: pickup date+time and return date+time in the tenant time zone; no address. Validation: return after pickup; pickup not in the past and not earlier than the tenant lead time; billed days within the tenant min/max (REQ-8, defaults min 1 day, max 30 days, lead time 0, buffer 0). | M | §6.1 |
| FR-PUB-03 | Results show only vehicles available for the period: no overlapping non-cancelled booking (respecting the buffer), vehicle not in maintenance and not archived. Card: photo, name, daily price (tenant currency), fuel, seats, **Select**, computed days and total. | M | §6.2 |
| FR-PUB-04 | Sort by price (default ascending) and filter by category; optional fuel and seats. On mobile, filters open in a bottom sheet/drawer. | M | §6.2, §10.1 |
| FR-PUB-05 | Booking form: first name, last name, phone (required); email (optional); validated; phone normalised. Shows links to the tenant's privacy notice and rental terms (REQ-12) with the acknowledgement text (A-16). | M | §6.3 |
| FR-PUB-06 | On submit the availability is re-checked and the booking created atomically (FR-BKG-08), status `confirmed`, unique code (A-12). | M | §6.4 |
| FR-PUB-07 | Confirmation screen: code, vehicle, dates, customer, price, "pay on site by card or cash", PDF download; PDF emailed when an email was provided and SMTP works. An email also goes to the tenant admin (FR-MAIL-07). | M | §6.4 |
| FR-PUB-08 | If the vehicle was taken meanwhile, a clear message returns the user to results for the same dates without losing form data. | M | §10 |
| FR-PUB-09 | Empty state when nothing is available; loading and error states at each step. | M | §10.2 |
| FR-PUB-10 | Abuse protection (REQ-7): rate limit 10 booking submissions per hour per IP, max 3 open future bookings per phone per tenant, hidden honeypot field; no CAPTCHA; search throttling per NFR-SEC-05. | M | REQ-7 |
| FR-PUB-11 | Price at search equals the stored snapshot; if the vehicle price changed between search and submit, the new price is shown before final confirmation. | M | §6, §9 |
| FR-PUB-12 | Price calculation is one pure, extensible function `(vehicle, period, tenant rules) -> breakdown`, used by search, public booking, admin booking/edit and PDF. Rule (REQ-1): **billed days = calendar days touched in the tenant time zone**; total = days x daily price; same-day rental = 1 day; a return at exactly 00:00 does not touch the new day (A-11). | M | §6 |
| FR-PUB-13 | No non-essential cookies or third-party requests on public pages. | M | §10.2 |
| FR-PUB-14 | Minimal SEO baseline: title and description from tenant title; `noindex` on confirmation, 404 and unavailable pages. | S | discovery E20 |

**US-020 Search availability** (M · FR-PUB-02/03 · AC3)
- Given vehicle V has a confirmed booking 1 Jun 10:00 to 3 Jun 10:00, When I search 2 Jun 09:00 to 4 Jun 09:00, Then V is not listed.
- Given V has a booking ending 3 Jun 10:00 and buffer 0, When I search pickup 3 Jun 10:00, Then V is listed (A-22).
- Given a buffer of 60 minutes, When I search pickup 3 Jun 10:30, Then V is not listed; at 11:00 it is.
- Given V is in maintenance (toggle on) or archived, When I search any period, Then V is never listed.
- Given only a cancelled booking in the period, Then V is listed.
- Given a return before pickup, a pickup in the past or before the lead time, or billed days outside min/max, When I submit, Then I see a field-level error naming the rule and no search runs.
- Given no results, Then an empty state invites changing dates.

**US-021 Sort and filter** (M · FR-PUB-04)
- Given results, When I sort by price descending, Then cards are ordered by daily price descending, ties by name.
- Given I filter category SUV and 5+ seats, Then only matching vehicles show, with removable filter chips.
- Given 375px, When I tap Filters, Then a bottom sheet opens with touch targets >= 44x44px.

**US-022 Book a vehicle** (M · FR-PUB-05/06/07 · AC3)
- Given I selected a vehicle, When I submit first name, last name, phone, Then a booking is created `confirmed`, with a unique code, a summary and total from the price function.
- Given email omitted, Then no email is attempted and PDF download is offered.
- Given email provided and tenant SMTP configured, Then the PDF is emailed and the result recorded.
- Given a required field empty or invalid, Then field errors appear and no booking is created.
- Given email delivery fails, Then the booking stays confirmed and code and summary are still shown.
- Given the tenant has a privacy notice and terms, Then both links are visible before the submit button.

**US-023 Concurrent booking** (M · FR-PUB-08, FR-BKG-08 · AC4)
- Given two customers submit overlapping bookings for the same vehicle at the same moment, Then exactly one is confirmed and the other sees the "no longer available" message.
- Given an admin and a customer book simultaneously, the same rule applies.

**US-024 Abuse protection** (M · FR-PUB-10)
- Given 10 submissions from one IP within an hour, When another arrives, Then a generic "try again later" message is shown.
- Given the honeypot is filled, Then no booking is created and no signal is given to the bot.
- Given a phone with 3 open future bookings, When it books again, Then the user is told to contact the rental business.

**US-025 Tenant unavailable pages** (M · FR-PUB-01, FR-SYS-12/13)
- Given an unknown slug, Then a generic 404.
- Given a suspended tenant, Then "temporarily unavailable" with the tenant name and contact info, no search form.
- Given a tenant past grace, Then "bookings unavailable" with contact info.

### EP-04 Admin calendar (§7.1)

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-CAL-01 | Grid view: vehicles as rows sorted by name (case-insensitive, natural order), days as columns, bookings across the days they cover. | M | §7.1 |
| FR-CAL-02 | Switchable views: grid (default on desktop), month, week, day (default on small screens). | M | §7.1 |
| FR-CAL-03 | Today's column/cell highlighted with a distinct color, in the tenant time zone; not by color alone. | M | §7.1 |
| FR-CAL-04 | Clicking a booking opens its details; operators read-only. | M | §7.1 |
| FR-CAL-05 | Previous/next/today controls and date picker; period in URL. | M | gap |
| FR-CAL-06 | Bookings labelled/colored by status; cancelled hidden by default with a toggle (A-17); vehicles in maintenance marked; vehicles currently rented shown as "rented" (derived from an active booking, REQ-9). | S | §7.1 |
| FR-CAL-07 | Only the visible range is loaded; no drag and drop. | M | §7.1 |
| FR-CAL-08 | Loading, empty and error states. | M | §10.2 |
| FR-CAL-09 | Admin can start a new booking from an empty cell (prefilled vehicle/date). | C | gap |
| FR-CAL-10 | Archived vehicles hidden unless they have bookings in the visible range (A-18). | S | gap |

**US-030 Calendar grid** (M · FR-CAL-01/02/03 · AC5)
- Given vehicles "Fiat Panda", "Audi A3", "bmw X1", Then rows are ordered Audi A3, bmw X1, Fiat Panda.
- Given today is 12 Jun in the tenant time zone, Then that column is highlighted; at 00:30 tenant time on 13 Jun it is 13 Jun that is highlighted, regardless of the browser time zone (A-19).
- Given I switch between grid, month, week, day, Then the range changes and bookings stay consistent.
- Given a booking spans 3 days, Then it appears continuously across 3 columns.

**US-031 Open booking from calendar** (M · FR-CAL-04)
- Given a booking, When I click or tap it, Then its detail opens; for an operator all edit actions are absent.

**US-032 Mobile calendar** (M · FR-UX-05 · AC11)
- Given 375px, Then day view is default, the grid scrolls horizontally with a sticky vehicle-name column, and the page does not scroll horizontally.

### EP-05 Vehicles and expenses (§7.2)

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-VEH-01 | Fields: name, plate, make, model, category, fuel type, seats, daily price, status, photos (multiple), notes. Plate unique per tenant (case/space-insensitive). | M | §7.2 |
| FR-VEH-02 | Fixed lists: categories (city, compact, sedan, SUV, van, convertible, luxury, other) and fuel types (petrol, diesel, hybrid, plug-in hybrid, electric, LPG/CNG) (A-20). | M | §6.2 |
| FR-VEH-03 | Status: stored statuses are `available` and `maintenance` (REQ-9). "Maintenance" is a simple "in maintenance now" toggle; while on, the vehicle is excluded from all public searches. `rented` is displayed, derived from an active booking, never stored. | M | §7.2 |
| FR-VEH-04 | Turning maintenance on does not cancel existing future bookings; the admin sees a warning listing them. Admin-created future bookings on a vehicle in maintenance are rejected (past bookings are exempt, A-24). | M | §6.2 |
| FR-VEH-05 | Photos: multiple upload (JPEG/PNG/WebP, <= 5 MB each, <= 10 per vehicle, A-23), reorder, cover, delete; via storage adapter; validated by content. | M | §2, §7.2 |
| FR-VEH-06 | List with search by name/plate and filters (status, category); detail with bookings and expenses summary. | M | §7.2 |
| FR-VEH-07 | Changing the daily price affects new bookings only (snapshot, FR-BKG-05); recomputation on booking edit uses the snapshot rule in FR-BKG-16. | M | §9 |
| FR-VEH-08 | A vehicle with bookings or expenses is archived, not deleted (hidden from public/new bookings, kept in history and revenue, not counted toward maxVehicles) (A-18). Otherwise it can be deleted. | M | gap |
| FR-VEH-09 | Expenses per vehicle: date, category (purchase cost, repair, maintenance, other), amount (> 0, 2 decimals, tenant currency), description; create, edit, delete; filters by category/date; total shown. | M | §7.2 |
| FR-VEH-10 | An expense belongs to exactly one vehicle (spec §12); expenses of archived vehicles remain in figures. | M | §12 |
| FR-VEH-11 | An expense created, edited or deleted with a date in a closed year is allowed and triggers a snapshot correction (REQ-4, FR-REV-07). Blocked in read-only. | M | §7.6 |
| FR-VEH-12 | The data model must allow adding mileage and document expiry later without breaking changes; not built now. | W | §7.2 |

**US-040 Add vehicle** (M · FR-VEH-01/05)
- Given valid fields and 2 photos, Then the vehicle appears in the list and, if not in maintenance, in public results.
- Given a duplicate plate in the same tenant, Then a validation error; the same plate in another tenant is accepted.
- Given a non-image or >5 MB file, Then the upload is rejected with a clear message.
- Given the limit is reached, Then FR-SYS-08 applies.

**US-041 Maintenance toggle** (M · FR-VEH-03/04)
- Given an available vehicle, When I switch maintenance on, Then it disappears from public search immediately.
- Given future bookings exist, Then I see a warning listing them and they stay confirmed.
- Given a vehicle with an active booking, Then it shows as "rented" in lists and calendar without any manual status.

**US-042 Archive vehicle** (M · FR-VEH-08)
- Given a vehicle with past bookings, When I choose Delete, Then I am offered Archive; afterwards it is not offered publicly but past bookings and revenue remain.

**US-043 Record expenses** (M · FR-VEH-09 · AC6)
- Given a vehicle, When I add a "repair" expense of 120.00 dated today, Then it appears in the list and in revenue views for the current month and year.
- Given an invalid amount (0, negative, text), Then a validation error.
- Given an existing expense, When edited or deleted, Then revenue figures update.

### EP-06 Bookings (§7.3)

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-BKG-01 | List with filters (status, date range, vehicle), search by code/customer name/phone, sorting, pagination; stacked cards on mobile. | M | §7.3 |
| FR-BKG-02 | Detail: code, status, vehicle, customer (link), start/end in tenant time zone, billed days, daily price snapshot, total, payment method, paid flag, paid amount, balance, created timestamp, source (public/admin), history (audit entries for this booking). | M | §7.3 |
| FR-BKG-03 | Statuses: confirmed, active, completed, cancelled. Transitions: confirmed→active, active→completed, confirmed/active→cancelled; cancelled is final; completed can be reopened only by an edit (FR-BKG-16). | M | §7.3 |
| FR-BKG-04 | **Automatic transitions** (REQ-2): confirmed→active at start time, active→completed at end time, by an idempotent job and also lazily evaluated on read. **Manual override** by the admin: mark active or completed at any time. Manually completing before the scheduled end sets `endAt` to the completion moment (price recomputed, FR-BKG-16); completing after the scheduled end leaves `endAt` unchanged. Automatic transitions never move a booking backwards and never override a manual cancellation. | M | §7.3 |
| FR-BKG-05 | `dailyPriceSnapshot` and `totalAmount` stored at creation; not recomputed from the current vehicle price except by an explicit edit (FR-BKG-16). | M | §9 |
| FR-BKG-06 | Admin creates a booking manually: vehicle, period, customer (existing or new), optional payment. Same availability, buffer, duration and price rules as public, no override. The admin may also create **past** bookings (to record earlier rentals); a past booking is created directly as `completed` (or `active` if it spans now) and counts in revenue (REQ-15, A-24). | M | §7.3 |
| FR-BKG-07 | Mark payment received: method (card/cash) and paid flag with `paidAmount` (= total at the time of marking); can be set at creation or later; can be unset with confirmation. Allowed in read-only (FR-ENF-01). | M | §6.5, §7.3 |
| FR-BKG-08 | Overlap prevention: for one vehicle two non-cancelled bookings may not overlap in [start, end) nor violate the tenant buffer; check and write are one atomic operation guaranteed at the data layer. Applies to public creation, admin creation and admin edits. | M | §10, AC4 |
| FR-BKG-09 | Admin cancels a booking (confirmed or active) with confirmation and optional reason; frees the vehicle immediately; cancelled bookings are excluded from revenue. Refunds happen outside the system. | M | §7.3 |
| FR-BKG-10 | Booking code unique, non-sequential, unguessable, human-friendly (A-12). | M | §6.4 |
| FR-BKG-11 | Creation idempotent against double submission. | M | gap |
| FR-BKG-12 | Billed days and total follow FR-PUB-12 (calendar days touched, REQ-1) everywhere. | M | §6 |
| FR-BKG-13 | Times stored as absolute instants, displayed/entered in the tenant time zone; DST never changes the number of billed days (calendar-day based). | M | gap |
| FR-BKG-14 | Operators have read-only access to list and detail, including customer contacts (REQ-11). | M | §4 |
| FR-BKG-15 | Admin can resend the confirmation email/PDF and download the PDF. | S | §6.4 |
| FR-BKG-16 | **Edit booking (REQ-15)**: the admin can always change start, end and vehicle of a booking that is not cancelled, and can edit notes. Every edit re-checks availability transactionally (FR-BKG-08, ignoring the booking itself), recomputes billed days and total with the current daily price of the (possibly new) vehicle, updates the snapshot, and writes an audit entry (old/new values). Edit semantics by status in FR-BKG-17. | M | REQ-15 |
| FR-BKG-17 | **Edit rules by state**: (a) *confirmed*: start, end and vehicle freely editable; (b) *active*: start is fixed (the rental has begun); end editable (extension = later end, early return = earlier end, both within availability and not before now) and vehicle swap allowed for the remaining period; (c) *completed*: dates and vehicle editable; status is re-evaluated by time (if the new end is in the future the booking returns to `active`; otherwise stays `completed`); revenue and, if the affected date falls in a closed year, the yearly snapshot are recomputed (REQ-4); (d) *paid*: the paid flag and `paidAmount` are kept, and the booking shows a **balance** = new total − paidAmount: positive = "amount due", negative = "overpaid, refund outside the system"; no automatic refund and no automatic change of payment state; (e) *cancelled*: not editable. | M | REQ-15 |
| FR-BKG-18 | Edit and manual creation/edit are not allowed in read-only (FR-ENF-01); payment and status updates are. | M | §5 |
| FR-BKG-19 | Optimistic concurrency: if a booking changed since the form was opened, saving shows a "changed by someone else, reload" message (A-34). | S | gap |

**US-050 List and filter bookings** (M · FR-BKG-01)
- Given 40 bookings, When I filter status=confirmed and a date range, Then only matches are shown, paginated, filters persist in the URL.
- Given no matches, Then an empty state with "clear filters".

**US-051 Create manual booking** (M · FR-BKG-06/08)
- Given an available vehicle and period, When the admin creates the booking for a new customer, Then it is stored `confirmed` with code, snapshot price and total, and appears in the calendar.
- Given a period overlapping another booking, violating the buffer, or a vehicle in maintenance for a future period, Then it is rejected with the reason.
- Given a period entirely in the past with no overlap, Then the booking is created as `completed` and included in revenue for the month of its end date.
- Given the tenant is read-only, Then creation is not possible.

**US-052 Record payment** (M · FR-BKG-07 · spec §6.5)
- Given an unpaid booking, When the admin selects "cash" and marks it paid, Then paid=true, method=cash, paidAmount=total are stored and visible in detail and customer history.
- Given a paid booking, When marked unpaid, Then a confirmation is required and the change is audit-logged.
- Given a read-only tenant, Then marking payment still works.

**US-053 Cancel booking** (M · FR-BKG-09)
- Given a confirmed booking, When the admin confirms cancellation, Then status is `cancelled`, the vehicle is free for that period and revenue excludes it.
- Given a completed booking, Then Cancel is not offered (it can be edited instead).
- Given a paid booking, Then the dialog warns that any refund happens outside the system.

**US-054 Status lifecycle** (M · FR-BKG-03/04)
- Given a confirmed booking whose start has passed, When the job runs (or the booking is read), Then status is `active`; once its end has passed, `completed`.
- Given the job runs twice, Then the result is identical.
- Given an admin manually completes an active booking 2 days before its scheduled end, Then status is `completed`, `endAt` equals the completion moment, days and total are recomputed, and an audit entry exists.
- Given an admin marks a confirmed booking `active` before the start time, Then it is active and the automatic job does not revert it.
- Given a cancelled booking, Then no transition is possible.

**US-055 Concurrency** (M · FR-BKG-08 · AC4)
- Given 20 concurrent requests for overlapping periods on one vehicle, Then exactly one succeeds (automated test).
- Given a booking ending when another starts (equal instant, buffer 0), Then both are accepted.
- Given two admin edits moving different bookings onto the same vehicle period, Then exactly one succeeds.

**US-056 Billed days and total** (M · FR-PUB-12, FR-BKG-12, REQ-1)
- Given daily price 40.00, When pickup is 1 Jun 10:00 and return 3 Jun 10:30, Then days = 3 and total = 120.00.
- Given pickup 1 Jun 10:00 and return 3 Jun 09:00, Then days = 3 (calendar days touched, not 24-hour blocks).
- Given pickup 1 Jun 10:00 and return 1 Jun 18:00 (same day), Then days = 1 and total = 40.00.
- Given a return at exactly 2 Jun 00:00 for pickup 1 Jun 10:00, Then days = 1 (A-11).
- Given a rental across a DST change, Then days are counted on tenant calendar dates and are unaffected by 23/25-hour days.

**US-140 Edit a confirmed booking** (M · FR-BKG-16/17)
- Given a confirmed booking for 3 days, When the admin moves it to another free vehicle and different dates, Then availability is re-checked, the total is recomputed with the new vehicle's daily price, the snapshot is replaced and the audit log records old and new values.
- Given the new period conflicts with another booking, Then the edit is rejected and the original is unchanged.
- Given another admin session saved a change meanwhile, Then the user sees the "changed by someone else" message (FR-BKG-19).

**US-141 Extend or shorten an active rental** (M · FR-BKG-17b)
- Given an active booking ending 10 Jun, When the admin sets the end to 12 Jun and the vehicle is free, Then `endAt` is updated, days and total grow accordingly and the audit log records it.
- Given the vehicle has another booking starting 11 Jun, Then the extension is rejected with the conflicting booking code.
- Given an early return (end set earlier than the scheduled end but not before now), Then the total decreases accordingly.
- Given the admin tries to change the start of an active booking, Then the field is not editable.

**US-142 Edit a completed booking** (M · FR-BKG-17c, REQ-4)
- Given a completed booking in the current year, When its end date is moved to the next month, Then revenue moves to that month in all views.
- Given a completed booking whose end is in a closed year, When it is edited, Then the snapshot of that year is recomputed as a new version with a "corrected on" trace (US-085).
- Given the new end is in the future, Then status returns to `active`.

**US-143 Edit a paid booking** (M · FR-BKG-17d)
- Given a booking paid in full (paidAmount 120.00), When an edit raises the total to 160.00, Then paid and paidAmount stay unchanged and the booking shows "Amount due: 40.00".
- Given an edit lowers the total to 100.00, Then it shows "Overpaid: 20.00 (refund outside the system)" and nothing is refunded automatically.
- Given the admin later marks payment again, Then paidAmount becomes the current total and the balance returns to 0.

### EP-07 Customers (§7.4)

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-CUS-01 | Customer list: name, phone, email, number of bookings, last booking date; search and pagination. | M | §7.4 |
| FR-CUS-02 | Customer detail: contact data and full booking history (code, vehicle, dates, amount, status, paid). (Spec §12: "cars used" = vehicles rented, via history.) | M | §7.4, §12 |
| FR-CUS-03 | A booking reuses an existing customer of the same tenant when the normalised phone matches (default country from tenant, REQ-10); existing name/email are never overwritten; the booking keeps a snapshot of the names given. | M | §9 |
| FR-CUS-04 | Admin can edit customer contact data. | S | gap |
| FR-CUS-05 | Admin can merge two customer records. | C | gap |
| FR-CUS-06 | GDPR: admin can anonymise a customer (name, phone, email replaced by irreversible placeholders; bookings, amounts, revenue kept). Blocked while the customer has open (confirmed/active) bookings. | M | GDPR |
| FR-CUS-07 | GDPR: admin can export a customer's data (contact details and history) as a file. | S | GDPR |
| FR-CUS-08 | Customer data is scoped to its tenant; the same person at two tenants is two unrelated customers. | M | §10 |
| FR-CUS-09 | Yearly privacy reminder (REQ-12): every January a job emails the tenant admin the number of customers with no booking for 24 months or more, with a link to review/anonymise them. No automatic deletion. | M | REQ-12 |

**US-060 Customer list and history** (M · FR-CUS-01/02)
- Given a customer with 3 bookings, Then the detail shows 3 rows (vehicle, dates, amount, status, paid), newest first.
- Given a customer with no bookings, Then an empty state.

**US-061 De-duplication** (M · FR-CUS-03)
- Given a customer with phone "+39 333 123 4567" exists, When a public booking uses "3331234567", Then it is attached to the same customer.
- Given a different phone, Then a new customer is created.
- Given the same phone with a different name, Then the stored customer is unchanged and the booking records the given name.

**US-062 Erase customer data** (M · FR-CUS-06)
- Given a customer with past bookings, When the admin anonymises after confirmation, Then name/phone/email are unretrievable in lists, details, bookings, regenerated PDFs, CSV exports and logs, while amounts and dates stay and revenue is unchanged.
- Given an open (confirmed/active) booking, Then anonymisation is blocked with an explanation.

**US-063 Tenant isolation of customers** (M · FR-CUS-08)
- Given the same phone booked at tenants A and B, Then each tenant sees only its own record.

**US-064 Yearly privacy reminder** (M · FR-CUS-09)
- Given it is January and 12 customers have had no booking for 24+ months, When the job runs, Then the admin receives one email with the count and a link; the job run twice sends once per year.

### EP-08 Operators (§7.5)

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-OPR-01 | Admin creates an operator (name, username, email); temporary password emailed through the tenant SMTP. | M | §7.5 |
| FR-OPR-02 | Operators are view-only with a fixed permission set: calendar, bookings (with customer contacts), vehicles (no expenses). No customer list, revenue, expenses, settings, audit log (REQ-11). | M | §4, §7.5 |
| FR-OPR-03 | Admin lists, edits (name, email), deactivates/reactivates operators and regenerates a temporary password. | S | gap |
| FR-OPR-04 | Active operators count toward maxOperators (FR-SYS-08). | M | §5 |
| FR-OPR-05 | If the tenant SMTP is missing or fails, the admin sees it and can regenerate and communicate a password; a temporary password is shown only in the email, or once to the admin who regenerates it when email is unavailable (A-26). | M | §4 |

**US-070 Create operator** (M · FR-OPR-01)
- Given valid data, Then the operator exists, receives a temporary password by email and must change it on first login.
- Given a username already used in this tenant, Then a validation error.
- Given the email fails, Then the operator is marked "credentials not delivered" and the admin can resend.

**US-071 Operator view-only** (M · FR-OPR-02 · AC8)
- Given an operator is logged in, When browsing calendar, bookings and vehicles, Then no create/edit/cancel/payment/delete control is shown, and customer name, phone and email are visible in booking detail.
- Given a direct write call, Then 403 (US-004).
- Given the operator opens revenue, expenses, customers, operators, settings or audit URLs, Then access is denied.

**US-072 Deactivate operator** (S · FR-OPR-03)
- Given an active operator with an open session, When deactivated, Then the next request fails and the slot is freed.

### EP-09 Revenue and yearly snapshots (§7.6)

**Definitions (REQ-3, REQ-1, A-27).**
- **Revenue** = sum of `totalAmount` of **completed** bookings only. Cancelled, confirmed and active bookings are not revenue.
- **Attribution date** = the booking's `endAt` (the effective return moment, which is the actual completion moment when the booking was completed early and edited by the admin; see FR-BKG-04/17), in the tenant time zone. A booking belongs to the month and year of its `endAt`, whole amount (no day-splitting).
- **Collected** = `paidAmount` of those bookings; **Outstanding** = Revenue − Collected (can be negative = overpaid; shown separately).
- **Expenses** = sum of expense amounts by expense date. **Net** = Revenue − Expenses.
- Bookings not yet completed are shown only as an informational "booked, not yet completed" figure (FR-REV-13).

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-REV-01 | Per-vehicle view: total revenue, expenses, net, with the same figures by month and by year. | M | §7.6 |
| FR-REV-02 | Global view: total revenue, expenses, net, by month and year across all vehicles (including archived). | M | §7.6 |
| FR-REV-03 | "Current year" counters reset on 1 January in the tenant time zone; all-time totals remain available. | M | §7.6 |
| FR-REV-04 | Show revenue, collected and outstanding; amounts in tenant currency, 2 decimals, `en` formatting. | M | §6.5 |
| FR-REV-05 | **Yearly snapshot**: when a calendar year ends (tenant time zone) a `RevenueYearSnapshot` is stored (per vehicle and global totals, `frozenAt`, `version` = 1) by an idempotent job after 1 January, plus lazy creation on first access if missing (A-28). | M | §7.6, AC7 |
| FR-REV-06 | Snapshots are viewable and comparable side by side (select 2+ years; global and per vehicle; absolute and % difference), always using the latest version of each year; a year with corrections shows a "corrected" badge. | M | §7.6 |
| FR-REV-07 | **Corrections of closed years (REQ-4)**: creating, editing, deleting or cancelling anything that changes the figures of a closed year (an expense dated in that year; a completed booking whose `endAt` is or was in that year, including edits that move it in or out) recomputes that year and stores a **new snapshot version** (version n+1, `correctedAt`, `reason` = triggering entity and change, `correctedBy`). Previous versions are retained and viewable. The recomputation happens in the same request/transaction as the change (or is guaranteed complete before the next read). Audit-logged. | M | §7.6, REQ-4 |
| FR-REV-08 | Charts are optional. | C | §7.6 |
| FR-REV-09 | CSV export of revenue tables (FR-CSV-01). | M | REQ-14 |
| FR-REV-10 | Per-vehicle sums equal the global figure for the same period (verified by test). | M | AC6 |
| FR-REV-11 | Revenue views are admin only; filter by year and vehicle. | M | §4 |
| FR-REV-12 | If only one year exists, comparison shows an explanatory empty state. | S | §10.2 |
| FR-REV-13 | Informational "booked, not yet completed" figure (confirmed + active, by start month), clearly separate from revenue. | C | REQ-3 |

**US-080 Per-vehicle revenue** (M · FR-REV-01 · AC6)
- Given vehicle V has two completed bookings of 100.00 and 150.00 ending in March and a 60.00 expense dated March, Then March shows revenue 250.00, expenses 60.00, net 190.00, and the year total matches.
- Given a cancelled booking of 80.00 in March, Then it is excluded.
- Given a confirmed (not completed) booking of 90.00 ending in March, Then it is not in revenue.
- Given a completed booking of 100.00 with paidAmount 0, Then revenue includes 100.00, collected 0.00, outstanding 100.00.

**US-081 Attribution by return date** (M · FR-REV-01/02 · REQ-3)
- Given a booking from 28 Mar to 3 Apr completed, Then its entire amount is in April (month of `endAt`), not March.
- Given a booking ending 31 Dec 23:30 tenant time (22:30 UTC), Then it belongs to December of that year.

**US-082 Global revenue** (M · FR-REV-02 · AC6)
- Given two vehicles, Then each global monthly row equals the sum of both vehicles' rows.
- Given an archived vehicle with completed 2025 bookings, Then its figures are in the global 2025 total.

**US-083 Yearly counters** (M · FR-REV-03)
- Given it is 2 Jan 2027 in the tenant time zone, Then "current year" shows 2027 only, and 2026 is in the archive.

**US-084 Year-end snapshot** (M · FR-REV-05 · AC7)
- Given 2026 has ended, When the job runs after 1 Jan 2027 tenant time, Then exactly one snapshot (version 1) exists with totals equal to the live computation at that moment.
- Given the job runs twice or reruns after a failure, Then still exactly one version 1 per tenant per year.
- Given the job did not run, When the admin opens the archive, Then the missing snapshot is created lazily.
- Given a read-only or suspended tenant, Then snapshots are still created.

**US-085 Correct a closed year** (M · FR-REV-07, FR-VEH-11 · REQ-4)
- Given 2026 is closed with revenue 10,000.00 and expenses 4,000.00, When in February 2027 the admin adds a repair expense of 500.00 dated 20 Dec 2026, Then a snapshot version 2 for 2026 shows expenses 4,500.00 and net 5,500.00, with `correctedAt` and a reason referencing the expense; version 1 remains viewable.
- Given the admin deletes that expense, Then version 3 restores expenses 4,000.00, and history shows three versions.
- Given a completed booking with `endAt` in 2026 is edited in 2027 so its total changes, Then a new 2026 version is stored.
- Given a comparison of 2025 and 2026, Then it uses the latest version of each and flags 2026 as corrected.
- Given a change that does not affect a closed year, Then no new version is created.

**US-086 Compare years** (M · FR-REV-06 · AC7)
- Given snapshots for 2025 and 2026, When both are selected, Then side-by-side rows (global and per vehicle) with differences are shown.
- Given only one snapshot, Then a message explains that two years are required.

### EP-10 Branding and settings (§7.7, §10.2)

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-BRD-01 | Admin edits title, logo (with alt text), colors: primary, secondary, accent, background, text. | M | §7.7, §10.2 |
| FR-BRD-02 | Branding applies to the public site and admin via per-tenant CSS variables. | M | §7.7, AC9 |
| FR-BRD-03 | Hover, disabled and on-color variants computed automatically. | M | §10.2 |
| FR-BRD-04 | WCAG AA contrast checked live (4.5:1 text, 3:1 large text/UI); warnings list failing pairs with a suggested fix. Saving allowed with warnings unless a pair is < 3:1, which is blocked (A-29). | M | §10.2, AC11 |
| FR-BRD-05 | Light default; dark follows the device; tenant setting auto/light/dark. | M | §10.2 |
| FR-BRD-06 | Tenant SMTP settings editable by admin; password encrypted; test email action. | M | §7.7 |
| FR-BRD-07 | Font from a short self-hosted list (Inter, Manrope, Plus Jakarta Sans). | M | §10.2 |
| FR-BRD-08 | Logo upload (PNG/JPEG/WebP, <= 1 MB, A-23); responsive in header; alt text required when a logo is set. | M | §10.2 |
| FR-BRD-09 | Tenant settings also include: contact info; **booking rules** (min duration default 1 day, max default 30 days, lead time default 0, buffer between rentals default 0, REQ-8; no opening hours); **privacy notice and rental terms** (link or text each, REQ-12); new-booking email toggle (FR-MAIL-07). Time zone and currency are set at creation and locked once a vehicle or booking exists (A-14). | M | §5, REQ-8, REQ-12 |
| FR-BRD-10 | Live preview of branding; reset to platform default. | S | gap |
| FR-BRD-11 | Colors stored as validated hex only. | M | §10 |
| FR-BRD-12 | Branded PDF and emails use tenant title, logo, primary color. | M | §2, §6.4 |
| FR-BRD-13 | Changes to settings (branding, SMTP, booking rules, privacy notice) are audit-logged without secret values. | M | REQ-14 |
| FR-BRD-14 | If the tenant has no privacy notice and terms, a platform template text is shown on the public form (marked as a template the tenant must review), and the admin sees a warning. Go-live per tenant requires the notice (REQ-12). | M | REQ-12 |

**US-090 Edit branding** (M · FR-BRD-01/02 · AC9)
- Given title "Sunny Rent", a logo and primary #0F766E, When saved, Then public and admin headers show them and the browser title uses the title.
- Given a logo > 1 MB or non-image, Then it is rejected.

**US-091 Contrast warning** (M · FR-BRD-04 · AC11)
- Given text #777777 on #FFFFFF (< 4.5), Then a visible warning names the pair, ratio and suggestion; a pair < 3:1 cannot be saved.
- Given only valid pairs, Then no warning.
- Given a primary color change, Then buttons, links and focus rings across the interface follow it.

**US-092 Dark mode** (M · FR-BRD-05)
- Given setting "auto" and a dark device, Then dark is used; given "light", light regardless of device.

**US-093 SMTP settings** (M · FR-BRD-06)
- Given saved SMTP settings, Then the password is encrypted and never returned; leaving it blank on edit keeps the existing one.

**US-094 Booking rules** (M · FR-BRD-09)
- Given min 2 days, max 10, lead time 3 h, buffer 60 min, When a customer searches for 1 day, or 11 days, or pickup in 1 hour, Then each is rejected naming the rule; a valid search succeeds.
- Given defaults unchanged (1/30/0/0), Then a same-day rental of a few hours is accepted (1 billed day).
- Given min greater than max, When the admin saves, Then a validation error.

**US-095 Privacy notice and terms** (M · FR-BRD-09/14 · REQ-12)
- Given the admin saves a privacy notice URL and terms text, Then the public booking form links to both.
- Given none are set, Then the admin sees a warning and the form shows the platform template.

### EP-11 Email and PDF (§2, §4, §6.4)

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-MAIL-01 | Tenant emails (booking confirmation, admin new-booking notification, operator/admin temporary passwords and resets initiated by the tenant, renewal reminder copy, yearly privacy reminder) go through the tenant SMTP; system emails (systemadmin reset, first-admin and replaced-admin passwords, owner notifications) through the environment SMTP. Where a tenant has no SMTP, system-originated tenant reminders use the system SMTP (A-10). | M | §2, §4, §8 |
| FR-MAIL-02 | Templates (plain text + HTML, English): temporary password, reset, booking confirmation (+PDF), new-booking notification, owner notifications, renewal reminder, privacy reminder. Tenant-sent mails are branded. | M | §6.4 |
| FR-MAIL-03 | Tenant without SMTP: no tenant emails; persistent admin warning; booking flow unaffected. | M | gap |
| FR-MAIL-04 | Delivery result (sent/failed + error summary, no secrets) recorded per email; visible to the admin for bookings and operators; resend available. | S | gap |
| FR-MAIL-05 | Email sending never blocks or fails a booking; bounded by timeout; must work in a serverless request or via a job adapter. | M | NFR-SRV-01 |
| FR-MAIL-06 | Emails never contain secrets; temporary passwords expire (FR-AUTH-11). | M | §4 |
| FR-MAIL-07 | **New-booking notification (REQ-14)**: on each new public booking an email goes to the tenant admin's address with code, vehicle, dates, customer name and phone, total. On by default; the admin can switch it off in settings. Failure does not affect the booking. | M | REQ-14 |
| FR-PDF-01 | Server-side PDF booking summary: code, vehicle, dates (tenant time zone), customer, daily price, billed days, total, payment note (pay on site), tenant branding, and the line "This document is a booking summary, not an invoice or receipt" (REQ-13). | M | §2, §6.4 |
| FR-PDF-02 | Generated on demand from stored data (screen download, email, admin re-download); after an edit the regenerated PDF reflects the current data (A-30). | M | §6.4 |
| FR-PDF-03 | A4, text-searchable, fonts embedded, works without a logo. | M | §6.4 |
| FR-PDF-04 | PDF access requires the unguessable booking code; no enumeration of bookings by code. | M | security |
| FR-PDF-05 | Prices are final and VAT-inclusive (REQ-13): no VAT lines in PDF or UI. | M | REQ-13 |

**US-100 Confirmation email** (M · FR-MAIL-01/02, FR-PDF-01 · AC3)
- Given an email and tenant SMTP, When the booking is confirmed, Then an email arrives from the tenant's from-address with the PDF attached containing code, vehicle, dates, customer, price and branding.
- Given the SMTP rejects the message, Then the booking stays confirmed, the failure is recorded and the admin can resend.

**US-101 PDF content** (M · FR-PDF-01/03/05)
- Given a booking of 3 billed days at 40.00, Then the PDF shows 40.00, 3 days, total 120.00 in the tenant currency, dates in tenant time, and the "not an invoice" line; no VAT line.
- Given no logo, Then the PDF renders with the title only.

**US-102 No SMTP configured** (M · FR-MAIL-03)
- Given a tenant without SMTP, When the admin opens the dashboard, Then a warning links to settings; public booking still works and offers PDF download.

**US-103 New booking notification** (M · FR-MAIL-07)
- Given the toggle is on, When a customer completes a public booking, Then the admin receives an email with the booking details; if the toggle is off or the SMTP fails, the booking is unaffected.
- Given a booking created by the admin in the admin area, Then no notification is sent.

### EP-12 Responsive and visual design (§10.1, §10.2)

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-UX-01 | Mobile-first: all public and admin pages usable from 320px to desktop (verified at 320, 375, 768, 1280). | M | §10.1, AC11 |
| FR-UX-02 | No horizontal page scrolling except inside the calendar grid. | M | §10.1 |
| FR-UX-03 | Touch targets >= 44x44px on touch viewports. | M | §10.1 |
| FR-UX-04 | Customer flow stacks vertically on mobile; filters in a bottom sheet/drawer. | M | §10.1 |
| FR-UX-05 | Admin on mobile: collapsed navigation; tables become stacked cards below a breakpoint; calendar day view default; grid scrolls horizontally with a sticky vehicle column. | M | §10.1 |
| FR-UX-06 | Playwright mobile-viewport test per main flow (public booking, admin login, calendar, booking management and edit, branding), on Chromium and WebKit emulation. | M | §10.1 |
| FR-UX-07 | Modern, professional style: radius token (e.g. `--radius-md: 12px`), soft shadows, whitespace, hierarchy. | M | §10.2 |
| FR-UX-08 | All colors, radii, shadows, fonts are CSS variables at tenant level; no hard-coded values. | M | §10.2 |
| FR-UX-09 | One component library and one icon set (shadcn/ui on Tailwind, Lucide). | M | §10.2 |
| FR-UX-10 | Every list, calendar and form has loading, empty and error states. | M | §10.2 |
| FR-UX-11 | Responsive logo with alt text. | M | §10.2 |
| FR-UX-12 | Forms: inline validation, preserved input on error, disabled submit while pending, confirmation for destructive actions. | M | gap |
| FR-UX-13 | Platform default theme for tenants without branding and for `/system`. | M | §10.2 |

**US-110 Mobile customer flow** (M · FR-UX-01..04 · AC11)
- Given 375px, When I complete search, selection and booking, Then every step is usable without horizontal page scroll, targets >= 44x44px, and the Playwright mobile test passes.

**US-111 Mobile admin** (M · FR-UX-05 · AC11)
- Given 375px (and 320px), When an admin opens bookings, vehicles, customers, Then lists are stacked cards, navigation is collapsed, no horizontal page scroll; the booking edit form is usable.

**US-112 Consistent states** (M · FR-UX-10)
- Given a slow network, Then a loader is shown; given an empty list, an empty state with a next action; given a failure, an error state with retry.

### EP-13 Platform: tenancy, deployability, pluggability

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-PLT-01 | `docker compose up` starts app and PostgreSQL (healthcheck, named volume), runs migrations automatically; `.env.example` documents all variables of §3. | M | §2, §3, AC1 |
| FR-PLT-02 | Seed script creates one systemadmin from env values for local development (idempotent; refuses production mode without an explicit flag). | M | §10 |
| FR-PLT-03 | Data access and storage behind repository/adapter interfaces; `DATABASE_URL` / `STORAGE_PROVIDER` change needs no code change; providers `local` and `s3`. | M | §2, AC10 |
| FR-PLT-04 | Tenant resolution has exactly one entry point (request in, tenant or not-found out), currently by `/{slug}`, so host-based resolution can be added without touching business code. | M | discovery C12 |
| FR-PLT-05 | Scheduled work (status transitions, year-end snapshots, subscription expiry and reminders, yearly privacy reminder) behind a job adapter, triggerable by an authenticated external scheduler or the container; all jobs idempotent and safe concurrently. | M | R-5 |
| FR-PLT-06 | Health endpoint (liveness + DB reachability) with no sensitive data. | M | §2 |
| FR-PLT-07 | Reserved namespace `/system`, `/api`, static paths cannot be slugs. | M | §6, §8 |
| FR-PLT-08 | Structured JSON logs with request id, tenant id, user id (no customer PII, no secrets); error tracking/metrics behind an adapter (free tier optional). | M | discovery G30 |
| FR-PLT-09 | Environment validated at startup; fail fast without printing secrets. | M | §3 |

**US-120 One-command start** (M · FR-PLT-01 · AC1)
- Given a machine with Docker and a copied `.env.example`, When I run `docker compose up`, Then the DB is healthy, migrations are applied, the app responds on `APP_BASE_URL`, and the seeded systemadmin can log in at `/system`.
- Given the DB container restarts, Then data persists.

**US-121 Swap DB and storage** (M · FR-PLT-03 · AC10)
- Given `STORAGE_PROVIDER=s3` with valid variables, Then uploads go to the bucket and display; switching back to `local` works without code changes (existing objects stay in their original provider unless migrated; documented).
- Given `DATABASE_URL` pointing to another PostgreSQL, Then migrations run and the app works.
- Given business-logic modules, Then no direct import of the DB client or storage SDK exists outside the adapter layer (architecture test).

**US-122 Single tenant resolution** (M · FR-PLT-04)
- Given the resolution function, When the path is `/{slug}/...`, Then it returns the tenant; a test proves a host-based resolver can replace it without changes in other modules.

**US-123 Jobs** (M · FR-PLT-05)
- Given the scheduled endpoint is called without the secret, Then 401; with it, jobs run and return counts; concurrent invocations do not duplicate effects.

### EP-14 Audit log and CSV exports (REQ-14)

| ID | Requirement | Pri | Spec |
|---|---|---|---|
| FR-AUD-01 | Append-only audit log recording who (user id/role, or "system"/"public customer"), when (UTC, shown in tenant time), entity and id, action, and changed fields (old/new values) for: bookings (create, edit, status change, cancel), payments (mark paid/unpaid), settings (branding, SMTP without secret values, booking rules, privacy notice), subscriptions and tenant status (create, edit, renew, cancel, suspend), admin reset/replacement, snapshot corrections, anonymisations and CSV exports. | M | REQ-14 |
| FR-AUD-02 | Admin views the tenant's audit log with filters (entity type, user, date range) and from each booking detail; systemadmin views subscription/tenant events. Operators cannot. | M | REQ-14 |
| FR-AUD-03 | Audit entries are tenant-scoped, cannot be edited or deleted through the application, and retained 24 months (A-35). Values avoid customer PII beyond identifiers (customer id, booking code); anonymisation does not break entries. | M | NFR-GDPR |
| FR-CSV-01 | Admin exports CSV of bookings (respecting current filters), customers, and revenue tables (per-vehicle and global, by month/year). | M | REQ-14 |
| FR-CSV-02 | CSV is UTF-8 with header row, dates ISO 8601 in tenant time, amounts with a dot decimal, protected against spreadsheet formula injection (cells starting with `= + - @` are neutralised), tenant-scoped, anonymised customers exported as anonymised. | M | NFR-SEC |
| FR-CSV-03 | Exports are admin only, work in read-only mode, are streamed or bounded to avoid timeouts (up to 50,000 rows), and each export is audit-logged. | M | REQ-14 |

**US-130 Audit trail of a booking edit** (M · FR-AUD-01)
- Given the admin changes a booking's end date and vehicle, Then the audit log contains one entry with user, timestamp, booking code and old/new values of both fields.
- Given the admin marks payment, Then an entry records method, amount and previous state.
- Given the admin edits SMTP settings, Then the entry names the changed fields but never the password value.

**US-131 View audit log** (M · FR-AUD-02/03)
- Given entries from many users, When the admin filters by booking code or date range, Then only matching entries show, newest first, paginated.
- Given an operator, Then the audit log is not accessible.
- Given no application route, Then entries cannot be modified or deleted.

**US-132 Export CSV** (M · FR-CSV-01..03)
- Given a filtered bookings list (status=completed, March), When the admin exports, Then the CSV contains exactly those rows with the listed columns and is audit-logged.
- Given a customer name starting with `=` , Then the cell is neutralised in the CSV.
- Given a read-only tenant, Then export works.
- Given tenant A's admin, Then no row of tenant B ever appears.

---

## 5. Non-functional requirements

| ID | Category | Requirement (quantified) | Verification |
|---|---|---|---|
| NFR-ISO-01 | Tenant isolation | Every tenant-owned table carries `tenantId`; every query is scoped through a mandatory data-access layer. Reading/writing another tenant's resource by id returns not-found/forbidden. Zero leaks, including audit log, CSV exports and snapshots. | Automated cross-tenant tests for every entity and API route (spec §10), blocking in CI |
| NFR-ISO-02 | Isolation | Files stored under tenant-prefixed keys; no listing across tenants; uploads cannot overwrite other tenants' keys. | Test |
| NFR-ISO-03 | Isolation | Caches and jobs keyed by tenant; no shared mutable state across tenants. | Review/test |
| NFR-SEC-01 | Security | OWASP ASVS L1 minimum, L2 for authentication, session and access control (final level set by cybersecurity-manager). | Security review |
| NFR-SEC-02 | Security | Passwords hashed with argon2id or bcrypt (~250 ms); SMTP passwords encrypted at rest with an environment key (rotation procedure documented); secrets never logged or returned. | Test + review |
| NFR-SEC-03 | Security | Server-side schema validation on every form/API route with max lengths; output encoding for user text. | Tests |
| NFR-SEC-04 | Security | Session cookies HttpOnly, Secure (non-local), SameSite Lax or stricter; CSRF protection; security headers (CSP, HSTS, X-Content-Type-Options, frame-ancestors none, referrer policy). | Automated header test |
| NFR-SEC-05 | Security | Rate limiting on login, password reset, search (5/min/IP) and public booking (10/h/IP); store must work without in-memory per-instance state (serverless). | Test |
| NFR-SEC-06 | Security | Uploads: content-type allowlist verified by magic bytes, size limits, randomised keys, no SVG. | Test |
| NFR-SEC-07 | Security | Booking codes >= 40 bits of entropy, reset tokens >= 128 bits, tokens stored hashed. | Review |
| NFR-SEC-08 | Security | Dependency and secret scanning in CI; no known critical/high vulnerability at release. | CI |
| NFR-GDPR-01 | Privacy | Each tenant is controller of its customers' data; the platform is processor (discovery D15). The owner provides a data-processing agreement (DPA) and a privacy-notice template; the tenant supplies its own notice and rental terms (REQ-12). A signed DPA and a configured notice are prerequisites for a tenant going live. | Legal review, go-live checklist |
| NFR-GDPR-02 | Privacy | Public form collects only first name, last name, phone, optional email; IP-based rate-limit data expires within 24 h. | Review |
| NFR-GDPR-03 | Privacy | Booking form shows links to the privacy notice and rental terms before submit. | Test |
| NFR-GDPR-04 | Privacy | Anonymisation (FR-CUS-06) is immediate; backups age out per provider (<= 35 days, A-31); export of a customer's data (FR-CUS-07). | Test |
| NFR-GDPR-05 | Privacy | Production DB, storage and email processors in the EU; sub-processors listed. | Deployment review |
| NFR-GDPR-06 | Privacy | Retention (REQ-12): customer personal data kept until the tenant anonymises it; a yearly reminder (FR-CUS-09) prompts review; no automatic deletion. Audit log 24 months; logs without PII <= 30 days. | Review |
| NFR-GDPR-07 | Privacy | No non-essential cookies/trackers; only a strictly necessary session cookie for logged-in users; no cookie banner. | Test |
| NFR-A11Y-01 | Accessibility | WCAG 2.2 AA on public flow and admin (EAA): keyboard operable, visible focus, landmarks/labels, error identification, target size, AA contrast with any tenant palette (FR-BRD-04), reduced-motion respected. | axe in Playwright + manual keyboard/screen-reader pass |
| NFR-A11Y-02 | Accessibility | The calendar grid is keyboard usable and has a non-visual equivalent (agenda list per day). | Manual test |
| NFR-PERF-01 | Performance | Public pages: LCP <= 2.5 s, CLS <= 0.1, INP <= 200 ms at p75 on simulated mobile 4G with 30 vehicles; images resized (max 1280 px; cards ~480 px), lazy-loaded. | Lighthouse CI |
| NFR-PERF-02 | Performance | Availability search with 50 vehicles and 5,000 bookings: p95 <= 500 ms server time at 20 concurrent users. | Load test |
| NFR-PERF-03 | Performance | Booking create/edit p95 <= 800 ms (excluding email/PDF; total response with email attempt <= 3 s via timeout). | Load test |
| NFR-PERF-04 | Performance | Calendar month for 50 vehicles x 31 days: <= 1.5 s p95 server + <= 2 s client on mid-range phone; admin lists paginated (default 25). | Test |
| NFR-PERF-05 | Performance | Revenue views for 5 years (50 vehicles, 10,000 bookings): p95 <= 1 s using aggregated queries; snapshot correction for one year <= 2 s. | Test |
| NFR-PERF-06 | Performance | CSV export up to 50,000 rows completes within 10 s or streams without timeout. | Test |
| NFR-SCL-01 | Scalability | Designed for <= 50 tenants, 50 vehicles each, 20 concurrent admin sessions per tenant, 100 concurrent public sessions, with 10x headroom without redesign. | Review |
| NFR-PLG-01 | Pluggability | DB and storage swappable by environment only (AC10); data access only via repositories/services; no Vercel-specific API outside an adapter. | Architecture test + manual swap test |
| NFR-PLG-02 | Pluggability | Email transport, PDF renderer, job scheduler, error tracking, rate-limit store accessed through interfaces. | Review |
| NFR-SRV-01 | Serverless compatibility | Runs on serverless functions with an external pooled PostgreSQL: no reliance on local disk (except `local` storage in dev), no in-process state or background threads, short-lived pooled connections, request duration limits respected (assume 10 s), PDF within memory/time limits, scheduled work triggered externally and idempotent. | Deployment smoke test on a serverless target |
| NFR-I18N-01 | Localisation | Single locale `en`; all user-visible text (UI, emails, PDF, errors) in a message catalog, never hard-coded; English keys; structure allows adding locales. Currency by tenant; dates and times in the tenant time zone (A-32). | Lint rule + review |
| NFR-TZ-01 | Time | One time zone and currency per tenant (default Europe/Rome, EUR); instants stored in UTC; DST-safe; "today", day counts, month and year attribution, snapshots all use the tenant time zone. | Tests with DST and year-boundary dates |
| NFR-COMP-01 | Compatibility | Last 2 versions of Chrome, Safari, Firefox, Edge; iOS 16+ Safari, Android 10+ Chrome; 320px and up. | Playwright (Chromium, WebKit, Firefox) |
| NFR-AVL-01 | Availability | Not critical (discovery D14): best effort, no SLA, no on-call; booking data never lost silently. | n/a |
| NFR-BKP-01 | Backup | Production DB automated daily backups, RPO <= 24 h, RTO <= 24 h; restore procedure tested once before go-live. | Restore test |
| NFR-OBS-01 | Observability | Critical journeys emit structured events without PII: public booking (search, select, submit, success/failure/conflict), login, booking edit, email send, PDF generation, job runs (transitions, snapshots, corrections, reminders). | Log review |
| NFR-OBS-02 | Observability | Business KPIs derivable without extra tooling: bookings per tenant per month, revenue per tenant, email failure rate. | Review |
| NFR-OBS-03 | Observability | No alerting now; optional free-tier error tracking behind an adapter; health endpoint; job-run log visible to the owner. Nobody is alerted (accepted risk RK-10). | Review |
| NFR-TST-01 | Quality | All business rules (availability and buffer, pricing by calendar days, transitions, edit rules, revenue attribution, snapshot versioning, subscription grace/read-only) covered by unit tests; each AC1..AC11 has at least one automated end-to-end or integration test. | CI |

---

## 6. Data and integrations

### 6.1 Main entities (spec §9 plus derived needs)
Spec entities: Tenant, Subscription, User, Vehicle, VehiclePhoto, Expense, Customer, Booking, RevenueYearSnapshot (with spec indexes).

Additional data implied (for the database-architect):
- Tenant: time zone, currency, contact info, accent/background/text colors, font, theme mode, logo alt text, privacy notice and rental terms (link or text), booking rules (min/max days, lead time, buffer), new-booking email toggle.
- Vehicle: archived flag, maintenance flag, photo order/cover (stored status only available/maintenance).
- Booking: `source`, customer name snapshot, `paidAmount`, cancelledAt/reason, billed days, created timestamp; `endAt` is the effective return moment and the revenue attribution date.
- Customer: normalised phone, anonymisedAt.
- User: temporary password expiry, last login, failed-login counters; exactly one active admin per tenant (constraint).
- RevenueYearSnapshot: `version`, `frozenAt`, `correctedAt`, `correctedBy`, `reason`; per-vehicle and global rows; previous versions kept.
- AuditLog (append-only), PasswordResetToken (hashed), EmailLog, JobRun, RateLimit buckets, notification markers (to keep reminders idempotent).

### 6.2 Integrations and dependencies
| System | Use | Notes |
|---|---|---|
| Tenant SMTP (per tenant) | Confirmation, admin notifications, operator/admin passwords and resets | Owned by tenant; failures visible (FR-MAIL-04) |
| System SMTP (env) | Systemadmin resets, admin passwords/replacement, owner notifications | Owner must provide a mailbox/provider |
| S3-compatible storage | Photos, logos (production) | Provider TBD, EU |
| PostgreSQL | All data | Provider TBD, EU, pooled connections |
| Scheduler | Transitions, snapshots, expiry, reminders | Provider-neutral; external trigger or container |
| Optional free-tier error tracking | Errors | Behind adapter |

### 6.3 Migration
Greenfield: no data to migrate. Dev seed of one systemadmin; production bootstrap by a documented one-off command (A-33).

---

## 7. Constraints
- Legal: GDPR (tenants controllers, platform processor; DPA and notices per REQ-12); EAA accessibility; rental terms are the tenant's own text; no fiscal documents (REQ-13).
- Technical (spec): Next.js App Router + TypeScript, PostgreSQL via ORM, schema validation, shadcn/ui + Tailwind, Lucide, server-side PDF, Docker Compose, no Vercel API outside an adapter, fonts not from third-party CDN.
- Budget: free tiers preferred; no paid third-party services in the base design.
- Time: none fixed; full scope with quality.
- Languages: English only (code, UI, docs).

---

## 8. Glossary
| Term | Meaning |
|---|---|
| Tenant | An independent rental business using the platform |
| systemadmin | Software owner; manages tenants and subscriptions |
| admin | The single administrator of a tenant |
| operator | Tenant staff member with view-only access |
| Booking code | Unique human-friendly identifier of a booking |
| Billed days | Calendar days touched by the rental in the tenant time zone |
| Snapshot | Frozen yearly totals (`RevenueYearSnapshot`), versioned when a closed year is corrected |
| Grace period | 7 days after subscription expiry during which the tenant works normally |
| Read-only | State where data can be viewed but only the operations in FR-ENF-01 are allowed |
| Slug | URL-safe tenant identifier in `/{slug}` |
| Period | Interval [pickup instant, return instant) |
| Balance | Booking total minus paidAmount |
| Tenant time zone | IANA time zone per tenant for all display and day/month/year boundaries |

---

## 9. Assumptions and risks

### 9.1 Spec §12 assumptions (adopted)
- S12-1 "Cars used" in the customer module = vehicles rented, covered by booking history (FR-CUS-02).
- S12-2 No promotions/discounts now; price function is the extension point (FR-PUB-12).
- S12-3 An expense belongs to one vehicle, never split (FR-VEH-10).

### 9.2 Analyst assumptions (proceeding unless corrected; none blocking)
| ID | Assumption |
|---|---|
| A-1 | Usernames unique per tenant (login is per tenant); systemadmin usernames unique globally. |
| A-2 | Password policy: >= 10 chars, no composition rules, common-password check; temporary password valid 7 days; reset link 60 minutes. |
| A-3 | Login lock: 5 failed attempts per account in 15 minutes triggers a 15-minute delay. |
| A-4 | Session: 30 min inactivity, 12 h absolute for tenant users; 15 min / 8 h for systemadmin. |
| A-5 | Slug: 3 to 40 chars, lowercase letters, digits, hyphens; immutable; reserved words blocked. |
| A-6 | One current subscription per tenant; renewal extends endDate or starts a non-overlapping period; history preserved. |
| A-7 | Suspension by the systemadmin is immediate, with no grace period; sessions are invalidated. |
| A-8 | Grace is 7 days after the end of endDate (tenant time zone). The renewal banner shows from 14 days before endDate through grace. A manually `cancelled` subscription has no grace: read-only immediately. |
| A-9 | In read-only the admin may still record payments and update the status of existing bookings (automatic transitions, manual active/completed, and cancellation), and export CSV; creating or editing bookings (dates/vehicle), vehicles, expenses, operators and settings is blocked. Rationale: lets a tenant close out rentals already agreed with customers while renewing. |
| A-10 | A missing or failing SMTP never blocks core actions; failures are logged and visible to the admin. Reminders addressed to a tenant admin whose tenant has no SMTP are sent through the system SMTP. |
| A-11 | Calendar-day rule details: the return instant is exclusive, so a return at exactly 00:00 does not touch that day; min/max duration are measured in billed days; lead time and buffer in minutes; time inputs in 15-minute steps; "now" pickup is rounded up to the next 15 minutes. |
| A-12 | Booking code: 8 characters, uppercase letters and digits excluding ambiguous ones (0/O, 1/I/L), shown as `XXXX-XXXX`, random, globally unique, not sequential. |
| A-13 | The systemadmin console shows tenant and subscription data and audit events of those, never customers or bookings. |
| A-14 | Tenant currency (ISO 4217, default EUR) governs prices, expenses and revenue; the subscription currency is independent. Currency and time zone are locked once a vehicle or booking exists (changes done manually by the owner). |
| A-15 | No tenant deletion in the UI (suspend only); permanent purge on request is a documented manual operation by the owner. |
| A-16 | The booking form shows "By continuing you acknowledge the privacy notice and rental terms" with links (not a pre-ticked consent box, processing being contractual). |
| A-17 | Cancelled bookings are hidden in the calendar by default and shown on toggle. |
| A-18 | A vehicle with any bookings or expenses is archived instead of deleted; archived vehicles do not count toward maxVehicles. |
| A-19 | All date logic uses the tenant time zone, never the browser's. |
| A-20 | Category and fuel lists are fixed as in FR-VEH-02. |
| A-21 | Payment tracking: one paid flag + method (card/cash) + `paidAmount`; no installments, deposits or refund records. |
| A-22 | Periods are half-open [start, end); the buffer is applied symmetrically (a new booking conflicts if it starts before an existing end + buffer, or ends after an existing start − buffer); default buffer 0. |
| A-23 | Upload limits: vehicle photos 5 MB, 10 per vehicle; logo 1 MB; JPEG/PNG/WebP. |
| A-24 | Manual and edited bookings follow the same availability, buffer and duration rules as public ones (including minimum lead time for future starts, not for past bookings). A vehicle in maintenance blocks future bookings but not past ones. A past booking is created as `completed`. |
| A-25 | Status after an edit is re-evaluated by time (see FR-BKG-17); a manual status set by the admin is not reverted by the automatic job. |
| A-26 | A temporary password is shown only in the email, or once to the actor who regenerates it when email is unavailable. |
| A-27 | Revenue is attributed to the month of `endAt` in the tenant time zone, whole amount. A manual early completion sets `endAt` to the completion moment so the same field drives revenue; a late manual completion keeps the scheduled `endAt`. |
| A-28 | The year-end job runs daily; it creates the snapshot of year Y for each tenant once its time zone has passed 1 Jan Y+1 00:00; plus lazy creation. A correction creates a new version synchronously. |
| A-29 | Contrast: warn below AA; hard-block only below 3:1. |
| A-30 | PDFs are generated on demand and not stored; an edited booking's resent PDF shows current data. |
| A-31 | Backups retained <= 35 days. |
| A-32 | English display formats: dates `DD Mon YYYY`, 24-hour time, amounts with currency symbol or ISO code and two decimals. |
| A-33 | Production systemadmin is created by a one-off documented command from environment values, not by the dev seed. |
| A-34 | Concurrent edits are resolved with optimistic locking and a clear message. |
| A-35 | Audit log retention 24 months; the audit log covers the events listed in FR-AUD-01 and nothing else. |
| A-36 | The new-booking admin email goes to the admin's account email; there is no separate notification address. |
| A-37 | The yearly privacy reminder uses a fixed threshold of 24 months without booking, sent in the first week of January. |
| A-38 | CSV exports are capped at 50,000 rows per file (larger sets: narrow the filter). |
| A-39 | Replacing the tenant admin keeps the old admin's audit history under the old (now inactive) username. |

### 9.3 Risks
| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| RK-1 | Pay-on-site without verification enables fake bookings that block vehicles | high | FR-PUB-10 (IP and phone limits, honeypot); admin can cancel quickly; captcha/verification excluded by REQ-7, revisit if abused |
| RK-2 | Editing bookings at any time (including completed and paid ones) can silently shift revenue and closed years | high | Versioned snapshots (FR-REV-07), audit log, balance display, tests |
| RK-3 | Serverless limits (time for PDF+email, cron availability, connection pools) | high | NFR-SRV-01, adapters, on-demand PDF, idempotent jobs, lazy snapshot |
| RK-4 | Tenant SMTP misconfiguration silences all customer emails | medium | Test email, warnings, resend |
| RK-5 | GDPR obligations unclear between owner and tenants | high | REQ-12: DPA, templates, go-live prerequisite (NFR-GDPR-01) |
| RK-6 | Time zone / DST defects around calendar-day counts and month/year attribution | medium | NFR-TZ-01, DST and year-boundary tests |
| RK-7 | Tenant colors hurt readability | medium | FR-BRD-04 (RAID R-1) |
| RK-8 | Snapshot or reminder job missed on serverless | medium | Lazy creation, idempotent jobs, job-run log |
| RK-9 | Revenue counts only completed bookings, so forgotten manual statuses or failed jobs under-report revenue | medium | Automatic transitions, lazy evaluation on read, FR-REV-13 informational figure |
| RK-10 | No alerting means silent failures (email, jobs) | medium | Visible failure states, job-run log; accepted by user (G27) |
| RK-11 | Single admin per tenant: lockout if the person leaves | medium | FR-SYS-15 recovery by the systemadmin |
| RK-12 | Revenue by calendar days touched and by return date may differ from accountants' expectations (no VAT, no invoices) | low | Documented in PDF and UI (REQ-13), CSV export for external accounting |

---

## 10. Decisions from the user (REQ-1..REQ-16, answered 2026-11-01)

All questions are closed. No new blocking question was identified.

| ID | Decision | Integrated in |
|---|---|---|
| REQ-1 | Billed days = calendar days touched in the tenant time zone (1 Jun 10:00 to 3 Jun 10:30 = 3 days; same-day = 1 day); in the single extensible pricing function | FR-PUB-12, FR-BKG-12, US-056, A-11 |
| REQ-2 | Automatic status transitions at pickup/return time, with manual override by the admin | FR-BKG-03/04, US-054 |
| REQ-3 | Revenue = completed bookings only, attributed to the month of return (`endAt`, which equals the actual completion moment when completed early); paid vs unpaid shown | EP-09 definitions, FR-REV-04, US-080/081, A-27 |
| REQ-4 | Closed years are correctable; changes recompute the snapshot as a new version with a "corrected on" trace; versions kept | FR-REV-05/06/07, FR-VEH-11, US-085, US-142 |
| REQ-5 | 7-day grace after expiry with renewal banner, then public "bookings unavailable" and staff read-only; existing bookings remain valid. Suspension is immediate. In read-only, payments and status updates remain allowed | FR-SYS-07/12/13, FR-ENF-01, US-014, A-7/8/9 |
| REQ-6 | No customer self-service; only the business cancels | Out of scope 3.3, FR-BKG-09 |
| REQ-7 | 10/h per IP, max 3 open future bookings per phone, honeypot, no CAPTCHA | FR-PUB-10, US-024, NFR-SEC-05 |
| REQ-8 | Per-tenant booking rules: min 1 day, max 30 days, lead time 0, buffer 0 (defaults); no opening hours | FR-PUB-02, FR-BRD-09, US-094 |
| REQ-9 | Maintenance = simple "in maintenance now" toggle excluding the vehicle from all searches; "rented" derived from bookings | FR-VEH-03/04, US-041 |
| REQ-10 | Returning customer matched by normalised phone; no overwrite | FR-CUS-03, US-061 |
| REQ-11 | Operator sees calendar, bookings with customer contacts, vehicles; not revenue, expenses, customer list, settings | FR-OPR-02, FR-BKG-14, US-071, permission matrix |
| REQ-12 | Tenant provides its own privacy notice and rental terms; owner provides template and DPA; data kept until the tenant anonymises, with yearly reminder; required before go-live | FR-BRD-09/14, FR-CUS-06/09, NFR-GDPR-01/06, US-064/095 |
| REQ-13 | Prices final, VAT included; no invoices or receipts; PDF is a booking summary | FR-PDF-01/05, US-101 |
| REQ-14 | All extras in scope: admin email per new public booking; owner emails on tenant creation and 14 days before expiry; CSV exports; audit log | FR-MAIL-07, FR-SYS-14, EP-14, US-017/103/130-132 |
| REQ-15 | Admin can always edit dates and vehicle (availability re-check, price recompute); active = extension/early return; completed = revenue and snapshot recompute; paid = balance shown, no auto refund; admin can create past bookings | FR-BKG-06/16/17/18, US-051, US-140..143 |
| REQ-16 | One admin per tenant; systemadmin can reset/replace the admin | FR-SYS-15, US-016, permission matrix |

---

## 11. Traceability

### 11.1 Spec acceptance criteria to requirements

| AC | Statement (short) | Functional requirements | User stories | NFR |
|---|---|---|---|---|
| AC1 | `docker compose up` runs app + DB, auto migrations | FR-PLT-01, 02, 06, 09 | US-120 | NFR-PLG-01 |
| AC2 | Systemadmin creates tenant + subscription; admin gets temporary password | FR-SYS-01..09, FR-SYS-14, FR-AUTH-03/04, FR-MAIL-01 | US-010, US-001, US-012, US-013, US-017 | NFR-SEC-02 |
| AC3 | Customer searches, sees only available vehicles, books, gets code + PDF | FR-PUB-01..09, 11, 12, FR-BKG-08/10, FR-MAIL-01/02, FR-PDF-01..05 | US-020, US-021, US-022, US-056, US-100, US-101 | NFR-PERF-01..03 |
| AC4 | Overlapping bookings cannot both be confirmed | FR-BKG-08, 11, 16, FR-PUB-08 | US-023, US-055, US-140, US-141 | NFR-ISO-01 |
| AC5 | Calendar sorted by name, month/week/day, highlights today | FR-CAL-01..08 | US-030, US-031, US-032 | NFR-TZ-01, NFR-PERF-04, NFR-A11Y-02 |
| AC6 | Expenses and bookings feed per-vehicle and global revenue by month and year | FR-VEH-09/10, FR-REV-01..04, 10, FR-BKG-05 | US-043, US-050, US-080..083 | NFR-PERF-05 |
| AC7 | Yearly snapshot at year end, viewable for comparison | FR-REV-05, 06, 07, 12, FR-PLT-05 | US-084, US-085, US-086, US-123 | NFR-SRV-01, NFR-TZ-01 |
| AC8 | Operator can view but not modify bookings/vehicles | FR-OPR-01/02, FR-BKG-14, FR-AUTH-13, FR-VEH-06 | US-004, US-070, US-071 | NFR-SEC-01 |
| AC9 | Branding appears on public site and admin | FR-BRD-01/02/03/07/08/12, FR-UX-08/13 | US-090 | NFR-A11Y-01 |
| AC10 | Changing `DATABASE_URL` / `STORAGE_PROVIDER` needs no code change | FR-PLT-03, FR-PLT-04, FR-VEH-05 | US-121, US-122 | NFR-PLG-01/02, NFR-SRV-01 |
| AC11 | 375px usable, no horizontal scroll outside calendar; tenant colors theme everything; contrast warnings | FR-UX-01..13, FR-BRD-04/05, FR-CAL-02 | US-032, US-091, US-092, US-110, US-111, US-112 | NFR-A11Y-01, NFR-COMP-01 |

### 11.2 Spec sections to requirements

| Spec section | Covered by |
|---|---|
| §1 Overview | Section 1; EP-02, EP-03, EP-10; NFR-I18N-01 |
| §2 Stack, pluggability, storage, email, Docker, PDF | FR-PLT-01/03/05, FR-VEH-05, FR-BRD-06/08, EP-11, NFR-PLG-01/02, NFR-SRV-01 |
| §3 Environment variables | FR-PLT-01, 09, FR-MAIL-01, FR-AUTH-09, NFR-SEC-02 |
| §4 Roles and authentication | EP-01, EP-08, FR-SYS-15, permission matrix, NFR-SEC-01..07 |
| §5 Tenants and subscriptions | EP-02 (FR-SYS-01..15, FR-ENF-01) |
| §6 Public customer flow and pricing | EP-03, FR-BKG-05/10/12, FR-PUB-12, EP-11 |
| §7.1 Calendar | EP-04 |
| §7.2 Vehicles and expenses | EP-05 |
| §7.3 Bookings | EP-06 (FR-BKG-01..19) |
| §7.4 Customers | EP-07 |
| §7.5 Operators | EP-08 |
| §7.6 Revenue | EP-09, FR-CSV-01 |
| §7.7 Branding and settings | EP-10 |
| §8 Systemadmin area | EP-02, FR-AUTH-02 |
| §9 Data model and indexes | Section 6.1, FR-BKG-08, NFR-PERF-02 |
| §10 Non-functional | Section 5, FR-PLT-02, FR-BKG-08, FR-BRD-11 |
| §10.1 Responsive | FR-UX-01..06, FR-CAL-02, FR-PUB-04, NFR-COMP-01 |
| §10.2 Visual design | FR-UX-07..13, FR-BRD-01..14, NFR-A11Y-01 |
| §11 Acceptance criteria | Section 11.1 |
| §12 Assumptions | Section 9.1 (S12-1..3) |

### 11.3 User decisions to requirements
See section 10 (each REQ-n maps to requirement IDs and stories).

### 11.4 Discovery constraints to requirements
Local Docker then Vercel + external Postgres: NFR-SRV-01, FR-PLT-05 · scale: NFR-SCL-01 · EU/GDPR: NFR-GDPR-01..07 · time zone/currency per tenant: NFR-TZ-01, A-14 · path-based slug with single resolution point: FR-PLT-04 · no alerting, free-tier monitoring: NFR-OBS-01..03, FR-PLT-08 · English only: NFR-I18N-01 · no payments: section 3.3.

### 11.5 Priority summary (MoSCoW)
- Must: all requirements marked M (core of AC1..AC11, plus the user-approved extras: FR-SYS-14, FR-SYS-15, FR-MAIL-07, EP-14, FR-BKG-16/17).
- Should: FR-AUTH-11, FR-SYS-10, FR-PUB-14, FR-CAL-06, FR-CAL-10, FR-CUS-04, FR-CUS-07, FR-OPR-03, FR-BKG-15, FR-BKG-19, FR-MAIL-04, FR-BRD-10, FR-REV-12, US-072.
- Could: FR-CAL-09, FR-CUS-05, FR-REV-08, FR-REV-13.
- Won't (this version): FR-VEH-12 and everything in section 3.3.

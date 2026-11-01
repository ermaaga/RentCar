# Car Rental System: Specification for Claude Code

> Source: full specification provided by the user (@Ermal) on 2026-11-01. Kept as received (only markdown line breaks restored). This is the baseline input for requirements analysis.

## 1. Overview

A multi-tenant car rental platform. A **systemadmin** (the software owner) creates and manages **tenants** (rental businesses) and their subscriptions. Each tenant has its own public booking site, its own admin area, its own SMTP configuration, and its own branding. Each tenant's **admin** manages vehicles, bookings, customers, expenses, and revenue, and creates **operators**.

The entire UI and codebase are in **English only**.

## 2. Tech Stack and Architecture

- **Framework:** Next.js (App Router), TypeScript.
- **Database:** PostgreSQL, accessed through an ORM (Prisma or Drizzle). Connection via `DATABASE_URL`.
- **Storage (photos, logos, PDFs):** behind a storage adapter interface. Implement two providers: `local` (filesystem volume) and `s3` (any S3-compatible service). Selected with `STORAGE_PROVIDER`.
- **Database and storage must be pluggable.** Keep all data access behind repositories/services so the DB or storage can be swapped without touching business logic. The app must not depend on Vercel-specific APIs. If Vercel-specific features are used, they go behind an adapter.
- **Email:** each tenant has its own SMTP configuration. The systemadmin notifications use the SMTP settings from environment variables.
- **Docker Compose:** runs the app and PostgreSQL locally. Includes a healthcheck and a named volume for the DB. Provide `.env.example`.
- **PDF generation:** server-side (e.g. `@react-pdf/renderer` or Puppeteer); templates use tenant branding.

## 3. Environment Variables

```
DATABASE_URL=
STORAGE_PROVIDER=local|s3
STORAGE_LOCAL_PATH=
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
SYSTEM_ADMIN_EMAIL=          # software owner's email, used for system notifications
SYSTEM_SMTP_HOST=
SYSTEM_SMTP_PORT=
SYSTEM_SMTP_USER=
SYSTEM_SMTP_PASSWORD=
SESSION_SECRET=
APP_BASE_URL=
```

## 4. Roles

| Role | Scope | Capabilities |
|---|---|---|
| **systemadmin** | Platform | Create, edit, suspend tenants. Create subscriptions. Set SMTP and tenant config. Create the tenant's initial admin. |
| **admin** | One tenant | Manage vehicles, bookings, customers, expenses, revenue, calendar. Create operators. Edit tenant branding. |
| **operator** | One tenant | View calendar and bookings only. Cannot edit. |

Authentication: **username + password**. On account creation (tenant admin or operator), a temporary password is generated and emailed. The user must change it on first login. Password reset:

- Requested by an **operator** or **admin**: email sent through the **tenant's SMTP**.
- Requested for a **systemadmin**: email sent through the system SMTP.

OTP and biometric login are out of scope for now (leave a clear extension point in the auth module).

## 5. Tenants and Subscriptions

**Tenant fields:** name, slug (unique, URL-safe, used in the path `/{slug}`), contact info, logo, primary/secondary colors, title, SMTP host/port/user/password/from-address, status (active/suspended).

**Subscription fields (created manually by systemadmin):**

- maxVehicles
- maxOperators
- startDate, endDate (duration chosen by systemadmin)
- price and currency
- status (active, expired, cancelled)

Subscriptions can be edited and renewed at any time. Enforce limits: adding a vehicle or operator beyond the limit is rejected with a clear message. Expired subscriptions make the tenant read-only.

## 6. Public Customer Flow

Route: `/{slug}`

1. **Search:** the customer selects a pickup date and time, and a return date and time. No delivery address is requested.
2. **Results:** vehicle cards showing photo, name, daily price, fuel type, and seats. A **Select** button on each card.
   - Only vehicles available for the chosen period are shown. Availability: a vehicle is available if it has no overlapping booking and is not in maintenance status.
   - Sort and filter by: price, category (city, SUV, van, etc.), and optionally fuel and seats.
3. **Booking form:** first name, last name, phone (required); email (optional).
4. **Confirmation:** booking is confirmed immediately. The system generates a **unique booking code**. A PDF summary (booking code, vehicle, dates, customer, price, tenant branding) is emailed to the customer via the tenant SMTP if an email was provided. The code and summary are also shown on screen.
5. **Payment:** on site, by card or cash. Record the payment method and paid status in the admin; no online payment in this version.

Pricing: fixed daily price per vehicle. Total = days × daily price. Design the price calculation as a separate function so promotions and discounts can be added later.

## 7. Admin Area

Route: `/{slug}/admin`

### 7.1 Calendar

- **Grid view:** vehicles as rows, sorted by vehicle name; days as columns. Each cell shows bookings.
- **Views:** month, week, day, and the grid. Switchable.
- **Today's cell** is visually highlighted with a different color.
- No drag and drop in this version.
- Clicking a booking opens its details.

### 7.2 Vehicles

- Fields: name, plate, make, model, category, fuel type, seats, daily price, status (available, rented, maintenance), photos (multiple), notes.
- Mileage and document expiry dates (insurance, inspection) can be added later.
- **Expenses sub-section per vehicle:** purchase cost, repairs, maintenance, other. Each entry: date, category, amount, description.

### 7.3 Bookings

- List and detail views with filters (status, date range, vehicle).
- Statuses: confirmed, active, completed, cancelled.
- Admin can create bookings manually and mark payment received.
- Admin can cancel a booking.

### 7.4 Customers

- List of customers with contact details.
- Customer detail page with full booking history (every rental, vehicle, dates, amount).

### 7.5 Operators

- Create operators (name, username, email), set permissions implicitly (view only).
- Operator receives temporary password by email.

### 7.6 Revenue

- **Per vehicle:** total revenue vs total expenses vs net, with the same figures broken down by month and year.
- **Global:** total revenue, total expenses, net, by month and year.
- **Yearly counters** reset each calendar year for the current view.
- **Yearly archive:** each completed year is stored as a snapshot so years can be compared side by side.
- Charts are optional for the first version; tables are required.

### 7.7 Branding and Settings (admin)

- Title, logo, primary and secondary colors. Applied to both the public site and the admin area.
- Tenant SMTP settings (editable by admin, password stored encrypted).

## 8. Systemadmin Area

Route: `/system`

- Login as systemadmin (separate from tenant accounts).
- List, create, edit, suspend tenants.
- Create and edit subscriptions with limits, duration, and price.
- Create the first admin for a new tenant. Temporary password is emailed through the **system SMTP**.

## 9. Data Model (outline)

- `Tenant` (id, name, slug, status, branding fields, smtp fields encrypted)
- `Subscription` (id, tenantId, maxVehicles, maxOperators, startDate, endDate, price, currency, status)
- `User` (id, tenantId nullable for systemadmin, username, email, passwordHash, role, mustChangePassword, active)
- `Vehicle` (id, tenantId, name, plate, make, model, category, fuel, seats, dailyPrice, status, notes)
- `VehiclePhoto` (id, vehicleId, storageKey)
- `Expense` (id, tenantId, vehicleId, date, category, amount, description)
- `Customer` (id, tenantId, firstName, lastName, phone, email)
- `Booking` (id, tenantId, code unique, vehicleId, customerId, startAt, endAt, dailyPriceSnapshot, totalAmount, status, paymentMethod, paid)
- `RevenueYearSnapshot` (id, tenantId, year, totals per vehicle and global, frozenAt)

Indexes on `Booking(vehicleId, startAt, endAt)` and `Booking(tenantId, status)` for availability checks.

## 10. Non-functional Requirements

- All UI text in English, with the i18n structure kept simple (single locale).
- Branding (colors, title, logo) is configurable per tenant via CSS variables.
- Passwords hashed (argon2 or bcrypt). SMTP passwords encrypted at rest.
- Multi-tenant isolation: every query is scoped by `tenantId`. Add tests for cross-tenant access.
- Input validation on all forms and API routes (Zod or equivalent).
- Availability check must be transactional to prevent double bookings.
- Seed script creating one systemadmin from env values for local development.

### 10.1 Responsive Design and Mobile Use

- **Mobile-first:** every public page (customer flow) and every admin page must be fully usable on smartphones (320px width and up), tablets, and desktops.
- **Customer flow on mobile:** search, vehicle cards, and booking form stack vertically. Touch targets are at least 44×44px. Filters open in a bottom sheet or drawer.
- **Admin on mobile:** navigation collapses into a hamburger or bottom menu. The calendar grid scrolls horizontally with a sticky vehicle-name column. Tables become stacked cards below a breakpoint. Day view is the default on small screens.
- **No horizontal page scrolling** except inside the calendar grid.
- Test on Chrome and Safari mobile emulators; include at least one Playwright mobile viewport test per main flow.

### 10.2 Visual Design

- **Style:** modern and professional. Rounded corners on cards, buttons, inputs, and modals (consistent radius token, e.g. `--radius-md: 12px`). Soft shadows, generous whitespace, clear hierarchy.
- **Design tokens:** all colors, radii, shadows, and fonts are CSS variables defined at tenant level.
- **Theme colors chosen by the tenant admin** in the branding settings: primary, secondary, accent, background, and text color. The system computes readable variants (hover, disabled, contrast text) automatically and checks WCAG AA contrast, warning the admin if the chosen colors are not readable.
- **Light and dark mode:** light by default; dark mode follows the device preference and can be overridden by the tenant setting.
- **Typography:** one modern sans-serif font, selectable from a short list in the branding settings (e.g. Inter, Manrope, Plus Jakarta Sans). Loaded locally or via the storage adapter, not from a third-party CDN.
- **Logo:** displayed in the header, with a responsive size and an alt text field in the settings.
- **Components:** use a single component library (e.g. shadcn/ui on Tailwind CSS) so that visual consistency is guaranteed across the app.
- **Icons:** one consistent icon set (e.g. Lucide).
- **Feedback states:** every list, calendar, and form has loading, empty, and error states designed consistently.

## 11. Acceptance Criteria

1. `docker compose up` starts the app and DB; migrations run automatically.
2. Systemadmin can create a tenant with a subscription; the admin receives a temporary password by email.
3. Customer can search by dates, see only available vehicles, select one, and receive a booking code and PDF.
4. Two overlapping bookings for the same vehicle cannot both be confirmed.
5. Calendar grid shows vehicles sorted by name, switches between month/week/day, highlights today.
6. Expenses and bookings feed the per-vehicle and global revenue views by month and year.
7. Yearly snapshot is created at year end and viewable for comparison.
8. Operator can view but not modify bookings or vehicles.
9. Tenant branding (title, logo, colors) appears on the public site and admin.
10. Changing `DATABASE_URL` or `STORAGE_PROVIDER` works without code changes.
11. The public customer flow and the admin area are fully usable on a 375px-wide mobile screen, with no horizontal scrolling outside the calendar grid. Tenant colors change the whole interface, and contrast warnings appear when colors are not readable.

## 12. Assumptions to Confirm Later

- "Auto usate" in the customer module is interpreted as the vehicles each customer has rented (covered by the booking history).
- Promotions and discounts: not in this version; the pricing function is the extension point.
- Expenses are not split across vehicles; each expense belongs to one vehicle.

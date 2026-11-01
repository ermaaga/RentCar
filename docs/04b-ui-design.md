# UI design: RentCar

Version 0.1 · 2026-11-01 · Owner: ui-designer · Phase 4, wave B · Status: visual directions for decision. The design system (tokens.json, component specs) follows after the user chooses.
Inputs: `docs/04a-ux.md` (section 1 usage context, wireframes), spec section 10.2, ADR-0012 (theming), `docs/03b-struttura-codice.md` section 12.

## 1. Visual directions

Open `docs/design/index.html` in a browser. Every direction has 5 pages in `docs/design/<direction>/`: `public-search`, `public-booking`, `admin-today`, `admin-calendar`, `admin-branding`. Each page shows phone (375 px) and desktop (1200 px) frames, plus loading, empty and error states, and has selectors for tenant (platform default, Sunny Rent, Lemon Cars) and mode (light, dark).

### 1.1 Context analysis (summary)
- Customers: travellers, hurried, one hand, sun glare, roaming data, use it once or twice a year, fear hidden fees and a booking that does not exist.
- Staff: counter and car park, many times a day, interrupted, possibly gloves; operators must never press something destructive.
- Desk admin and systemadmin: calm, denser tables and calendar.
- Tenant brand is arbitrary and chosen by non-designers; WCAG 2.2 AA is required (EAA).
- Fixed by spec: rounded corners (`--radius-md`), soft shadows, whitespace, shadcn/ui + Tailwind, Lucide, one of Inter/Manrope/Plus Jakarta Sans (self-hosted), light default, dark by device or tenant.

### 1.2 Design principles (priority order, verifiable)
1. **Thumb first, glance fast**: targets at least 44 px on touch, one primary action per screen, main actions in thumb reach. Check: no horizontal scroll outside the calendar at 375 and 320 px.
2. **Any tenant palette stays readable**: semantic tokens only; hover, disabled, on-colour, link and dark variants are derived; status colours (success, warning, danger, info) are platform-fixed and never tenant-themed. Check: contrast table below for every theme.
3. **Never colour alone**: every status is icon + text; calendar adds border or pattern per status.
4. **Trust before polish (customer flow)**: running total, "Nothing was charged", large booking code.
5. **Legible in sunlight and in the dark**: AA everywhere; calibrated dark (not pure black).

### 1.3 Theming model used by all three (proposal for the `branding` module)
`deriveTheme(palette, mode)` yields: background, foreground, card, muted, muted-foreground, border, border-strong, primary, primary-foreground (white or near-black, whichever passes), primary-hover, primary-active, primary-soft and its foreground, **link** (primary darkened or lightened until it reaches 4.5:1 on background and card), ring (3:1), secondary and accent with on-colours, disabled. Dark mode regenerates background and text from the tenant hue (lightness about 9.5 percent) and lifts the primary until it passes. The mockups implement this function; the same code is the reference for the production one.
Contrast gate (what the Branding screen shows): text on background, button text on Primary/Accent/Secondary (automatic), primary as link text, focus ring, and the dark derivation. Levels: Pass, Warning, Blocked, and "Adjusted automatically" (info).

### 1.4 The three directions

| | **A. Clear** (recommended) | **B. Field** | **C. Warm** |
|---|---|---|---|
| Idea | Calm, neutral, trustworthy; the tenant brand is the only expressive colour | High contrast, big targets, built for counter and car park | Friendly, photo-led, travel-first |
| Platform default | primary #0F766E, secondary #1E3A4A, accent #F59E0B, bg #F6F8F9, text #0F1B24 | primary #1E40AF, secondary #0A0F1A, accent #FACC15, bg #FFFFFF, text #0A0F1A | primary #C2410C, secondary #234E3E, accent #E9A23B, bg #FBF7F1, text #2A2018 |
| Font | Inter | Manrope | Plus Jakarta Sans |
| Radius (sm/md/lg) | 8 / 12 / 16, buttons 12 | 10 / 14 / 20, buttons 14 | 12 / 20 / 28, pill buttons |
| Density | touch 44, text 16 | touch 52 (56 main), text 17 | touch 48, text 16 |
| Surfaces | white cards, 1 px hairline, very soft shadow | 2 px borders, near-flat shadow, header uses Secondary | borderless cards, larger soft shadows, 16:10 photos |
| Navigation | bottom bar with top indicator, sidebar from 1024 | 76 px bottom bar, filled pill on current | floating pill bar, tinted counters |
| Motion | 150 ms fades | none beyond feedback | 200 ms lift and fade, reduced-motion respected |
| Microcopy | plain, precise | short imperatives ("Call", "Mark paid") | friendly |
| Main risk | generic look | tool-like for customers; header depends on tenant Secondary | magnifies poor tenant photos; floating bar covers content; most combinations to verify |

Icons: Lucide, 2 px stroke, in all three. Images: vehicle photos cropped 16:9 (A, B) or 16:10 (C) with a neutral placeholder; tenant logos in a 34 px mark slot plus name.

### 1.5 Contrast evidence (computed with the mockup derivation, ratios x:1)
Text = foreground on background; Muted = muted text on card; Btn = button label on Primary; Link = link colour on background; Acc = label on Accent.

| Direction | Theme | Text | Muted | Btn | Link | Acc |
|---|---|---|---|---|---|---|
| A | default light / dark | 16.4 / 15.5 | 5.7 / 6.2 | 5.5 / 5.0 | 5.1 / 5.4 | 8.9 |
| A | Sunny light / dark | 15.0 / 15.4 | 5.3 / 6.2 | 5.9 / 5.1 | 5.6 / 5.3 | 6.9 |
| A | Lemon light / dark | 15.7 / 15.0 | 5.2 / 6.1 | 13.6 / 13.6 | 4.6 (link #897200, raw yellow 1.4) / 11.9 | 5.4 |
| B | default light / dark | 19.2 / 15.6 | 7.0 / 7.1 | 8.7 / 4.9 | 8.7 / 8.3 | 12.5 |
| B | Lemon light / dark | 15.7 / 15.0 | 7.1 / 7.2 | 13.6 / 13.6 | 7.2 (#665500) / 11.9 | 5.4 |
| C | default light / dark | 14.9 / 15.2 | 5.3 / 6.1 | 5.2 / 5.1 | 4.9 / 5.3 | 8.9 |

All 18 direction x tenant x mode combinations pass 4.5:1 on 18 checked pairs (including hover and active button states, soft chips, ring and border at 3:1). Known weak point: Field in dark mode has 4.9:1 on the button label (AA, below its 7:1 target).

### 1.6 Verification done on the mockups (Playwright, Chromium)
- 468 phone frames (3 directions x 5 pages x 3 themes x 375 and 320 px): no horizontal overflow outside the calendar grid.
- Touch targets measured on phone frames: all buttons, inputs, chips, nav and calendar bars at least 44 px high; booking-row names use a stretched link area.
- Not covered: tablet breakpoint (768 to 1023, icon rail), real photos, keyboard and screen-reader behaviour, real font files. These belong to the design system and implementation phases.

### 1.7 Recommendation
**A. Clear**, plus three borrowings: large time numerals and 48 px targets on Today (from Field), a 3 px focus ring with 2 px offset (Field), and friendlier confirmation copy (Warm).
Why: (1) principle 2 is the hardest constraint here, and neutral surfaces with the tenant colour on actions give the fewest unsafe combinations (B colours its header with the tenant Secondary, C tints the page and a hero panel); (2) small rental shops often have weak vehicle photos, which C exposes; (3) the customer flow is occasional and trust-driven, which A serves without B's heaviness; (4) staff needs are met by the Today borrowings. If staff at the counter are the buyers and sunlight use dominates, B is the better choice.

## 2. Mockup notes
Plain CSS variables named like shadcn tokens are used instead of the Tailwind CDN. Fonts load from Google Fonts for the mockups only (product: self-hosted woff2, ADR-0012). Mockups are prototypes, not production code. Generator source is not kept in the repo.

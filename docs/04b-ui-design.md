# UI design: RentCar

Version 1.0 · 2026-11-01 · Owner: ui-designer · Phase 4, wave B · Status: design system for approval. **Decisions (2026-11-01): UI-1 = direction Clear with three borrowings; UI-2 = automatic darker shade for links and text-sized accents, block only pairs with no automatic fix.** Defaults pending GATE 3: Inter self-hosted (UI-3), placeholder platform logo (UI-4), tenant photos with guidance (UI-5). Status colours are platform-fixed.
Tokens: `docs/design/tokens.json` (source for `scripts/build-tokens.ts`, see 03b section 12). Reference mockups: `docs/design/clear/`.
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
Plain CSS variables named like shadcn tokens were used instead of the Tailwind CDN; fonts loaded from Google Fonts for the mockups only. Mockups of B and C stay in `docs/design/` for reference but are not part of the system.

---

# Design system (direction Clear)

## 3. Principles applied
Section 1.2 principles decide doubtful cases, in order. The three borrowings are normative: (a) Today rows use time numerals 20 px / weight 800 / tabular and 48 px targets (`size.touch-today`); (b) focus ring is 3 px with 2 px offset everywhere; (c) confirmation and success copy follows the friendlier tone in section 15.

## 4. Color

### 4.1 Roles (CSS variable = `--<name>`; Tailwind maps `bg-primary` to `var(--primary)`)
Full values for light and dark are in `tokens.json` (`color.light`, `color.dark`). Components use **semantic roles only**: no hex, no arbitrary colour classes (03b section 12).

| Group | Roles | Controlled by |
|---|---|---|
| Surface | background, card, muted, border, border-strong (also `input`), scrim | tenant background and text, derived |
| Text | foreground, card-foreground, muted-foreground | tenant text, derived |
| Brand | primary, primary-foreground, primary-hover, primary-active, primary-soft, primary-soft-foreground, link, ring | tenant primary, derived |
| Secondary | secondary, secondary-foreground (headers, footers, avatar, sidebar highlight never) | tenant, derived |
| Accent | accent, accent-foreground, accent-soft, accent-soft-foreground ("Today" tag, badges) | tenant, derived |
| State | disabled-bg, disabled-fg | derived |
| Status | success, warning, danger, info, each with `-soft` and `-border` | **platform-fixed**, never tenant-themed |

shadcn aliases: `destructive` = `danger`; `popover`, `sheet`, `dialog` = `card`; `secondary` in shadcn terms (neutral button) = `muted` + `border`; the tenant Secondary is used only for header/footer areas and the avatar. `chart-*` not used in v1.

Platform default (Clear), light: primary #0F766E, secondary #1E3A4A, accent #F59E0B, background #F6F8F9, text #0F1B24. Dark values derive from the same algorithm (background #131A1D, card #21282B, text #EDF1F3, primary #129187).

### 4.2 deriveTheme(palette, mode) specification (reference implementation: mockup generator; production: `branding` module, pure function)
Input: five validated hex values (primary, secondary, accent, background, text) and `mode` in {light, dark}. Output: the roles above. All mixes are in sRGB; "ensure(fg, bg, min)" shifts the HSL lightness of fg in 1 percent steps (darker on light backgrounds, lighter on dark) until contrast(fg, bg) >= min, falling back to black or white.

Light:
1. background = input; foreground = ensure(text, background, 4.5); card = mix(background, white, 70 percent).
2. primary = input; primary-foreground = white if contrast(white, primary) >= 4.5, else the ink #0B0F14.
3. primary-hover = primary shifted 7 points of lightness toward darker (toward lighter only if the colour is dark and the label is ink); primary-active = 13 points. If the label contrast on hover or active falls below 4.5, keep primary.
4. link = ensure(ensure(primary, background, 4.5), card, 4.5). primary-soft = mix(background, primary, 12 percent); primary-soft-foreground = ensure(link, primary-soft, 4.5).
5. ring = ensure(ensure(link, background, 3), card, 3).
6. secondary = input, accent = input; each on-colour is chosen like primary-foreground. accent-soft = mix(background, accent, 22 percent); accent-soft-foreground = ensure(foreground, accent-soft, 7).
7. muted = mix(background, foreground, 5 percent); muted-foreground = ensure(mix(foreground, background, 34 percent), card, 4.5); border = mix(background, foreground, 14 percent); border-strong = input = ensure(mix(background, foreground, 50 percent), background, 3).
8. disabled-bg = mix(background, foreground, 9 percent); disabled-fg = mix(foreground, background, 55 percent) (disabled controls are exempt from contrast but must stay legible).

Dark: background = tenant background hue, saturation capped at 28 percent, lightness 9.5 percent; foreground = same hue, saturation capped at 20 percent, lightness 94 percent; card = mix(background, white, 6 percent); primary = ensure(primary, background, 4.5, lighter); secondary and accent keep the tenant value (used as fills with their own on-colour); muted/border mixes use 10 and 20 percent; the remaining rules are the same. Status roles come from the platform tables in `tokens.json`.

### 4.3 Contrast rules for the branding gate (rule text for FR-BRD-04, replaces the literal wording per decision UI-2)
The gate evaluates the pairs **as the product uses them after derivation**, in light and dark.

| Pair | Needed | Outcome below the threshold |
|---|---|---|
| Text on background (user input) | 4.5:1 | 3:1 to 4.5:1 = **Warning**, save allowed, with a one-tap suggested colour; below 3:1 = **Blocked** (no automatic fix) |
| Muted text (derived) on card | 4.5:1 | automatic correction, no message |
| Label on primary, accent, secondary | 4.5:1 | automatic choice of white or ink, always passes (maximum possible is at least 4.58:1); shown as Pass |
| Primary as link or text-sized brand colour | 4.5:1 | **Adjusted automatically** (info): links use the derived `link` shade; save allowed; show the shade and its ratio |
| Accent and secondary as text-sized colour | not used as text | nothing to check (fills only, with on-colour) |
| Focus ring on background and card | 3:1 | automatic correction; Pass |
| Dark derivation | all above | any pair adjusted in dark is listed as "Adjusted automatically" |

Save is blocked only when a pair has no automatic fix and is below 3:1 (in practice: text on background). The reason is shown next to the Save button, not only in the panel. Every row carries icon + word (Pass, Warning, Blocked, Adjusted automatically), never colour alone. Each fix is a button showing the new colour and ratio, reversible. The same function and thresholds run server-side on save (validation is authoritative; the client panel is advisory) and are covered by unit tests with the Lemon (bright yellow), Sunny, and platform palettes, plus mid-grey and near-white primaries as edge cases.

### 4.4 Status colours (fixed, platform)
Booking: Confirmed = info + `circle-check`; Active = primary-soft/primary + `car`; Completed = neutral + `check`; Cancelled = neutral, struck through + `x`. Payment: Paid = success + `check`; Unpaid and "Amount due" = warning + `circle-alert`; Overpaid = info + `info`. Danger is used for errors and destructive actions only. A tenant primary that looks like a status colour (e.g. red) is acceptable because status is always icon + text and uses its own soft backgrounds.

## 5. Typography
One family chosen by the tenant: Inter (platform default), Manrope or Plus Jakarta Sans; variable woff2 files in `public/fonts`, `font-display: swap`, only the selected family is requested, latin + latin-ext, weights 400 to 800 (trim to 400/500/600/700/800 variable axis; one file per family). The CSS variable is `--font-family-selected`. Monospace (system) only for booking codes and plates, with `letter-spacing: .04em` and `white-space: nowrap`.

| Style | Size / line | Weight | Use |
|---|---|---|---|
| Display (public hero H1) | 34 (28 on 320 to 374 px; 42 from 768) / 1.15 | 800, tracking -0.02em | Tenant hero |
| H1 | 28 / 1.15 | 800 | Page titles |
| H2 | 20 / 1.3 | 800 | Card and sheet titles |
| H3 | 18 / 1.3 | 700 | Vehicle name, section headings |
| Body | 16 / 1.5 | 400 to 500 | Everything else; never below 16 px in inputs (iOS zoom) |
| Small | 14 / 1.45 | 400 to 600 | Helper text, chips, table cells |
| Caption | 12 / 1.4 | 600 | Overlines (uppercase, tracking .06em), calendar badges |
| Numeral (Today time) | 20 / 1.2 | 800, tabular | Times on Today rows |
| Counter | 28 / 1.1 | 700 | Today counters |
| Booking code | 34 on confirmation, 14 inline | 800, mono | Code |
Prices and totals use tabular numerals. Text scales with user font size (rem in implementation); layouts must survive 200 percent text and 400 percent zoom; long unbreakable text (email, URL, plates, codes) uses `overflow-wrap: anywhere`; line length 60 to 75 characters for legal text.

## 6. Spacing, sizing and radius
Spacing scale (px): 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 (`spacing.*`). Phone page padding 16, desktop 32 (28 vertical); card padding 16; stack gap 16 (12 inside forms); list gap 10. Minimum gap between adjacent targets 8.
Radius: sm 8 (chips, small thumbnails), **md 12 (`--radius-md`: inputs, buttons, bars, panels)**, lg 16 (cards, sheets top corners), full (avatar, dots). Tenants cannot change the radius in v1; it is a platform token exposed as a variable so it can later become a tenant option.
Heights: touch 44 (below 768 px or `pointer: coarse`), Today rows and their actions 48, pointer density 36, top bar 56 (public 60), bottom navigation 64, sticky action bar 76, sidebar 240. Sticky heights are tokens and feed `scroll-padding` so focus is never covered (WCAG 2.4.11).

## 7. Elevation and shadow
Soft, low and warm-neutral. Levels: **0** flat (page); **1** `shadow.sm` + 1 px border (cards, rows, inputs on focus no shadow); **2** `shadow.md` (price badge, FAB, popovers); **3** `shadow.lg` (bottom sheets, dialogs, with scrim). Dark mode uses the `dark-*` shadows plus a lighter card colour for separation (cards are +6 percent white, borders +20 percent). Sticky bars add a 6 px upward soft shadow.

## 8. Motion
Durations: fast 150 ms (hover, press, chip), base 200 ms (sheet slide, dialog fade), slow 300 ms (rare). Easing standard `cubic-bezier(.2,0,0,1)`. Only opacity and transform animate. Skeletons appear after 300 ms (no flash) with a 1.4 s shimmer; the spinner rotates at 0.8 s. **Reduced motion** (`prefers-reduced-motion: reduce`): all durations 0 ms, shimmer and spinner static (spinner replaced by the "Saving…" label), calendar scroll-to-today is instant. Motion is decoration only; nothing depends on it.

## 9. Density and breakpoints
Breakpoints (Tailwind defaults): base 320, sm 640, md 768, lg 1024, xl 1280. Verification widths 320, 375, 768, 1024, 1280. Density is **touch** when width < 768 or `pointer: coarse` (targets 44, Today 48, spacing 8) and **pointer** otherwise (targets at least 36 high, never below 24x24 with spacing). Implement density with container queries or a `data-density` attribute on the shell, not with per-component media queries. Public content max 1120, admin max 1280.

## 10. Iconography
Lucide only, via `lucide-react` named imports (tree-shaken), 2 px stroke, `currentColor`, sizes 16 (chips, inline), 20 (buttons, default), 24 (navigation, empty states 24 in a 64 px tinted circle). Icons never carry meaning alone: visible label or `aria-label`; decorative icons `aria-hidden`. Mapping: Today `layout-dashboard`, Calendar `calendar`, Bookings `list`, Vehicles `car`, More `ellipsis`, Customers `users`, Revenue `trending-up`, Operators `key-round`, Settings `palette`/`settings`, Activity `clock`, Pickup `key-round`, Return `refresh-cw`, Paid `check`, Unpaid/due `circle-alert`, Info `info`, Error `circle-x`, Warning `triangle-alert`, Maintenance `wrench`, Call `phone`, Email `mail`, Card `credit-card`, Cash `banknote`, Download `download`, Copy `copy`, Filters `sliders-horizontal`, Fuel `fuel`, Seats `users`. Tenant logo: 34 px square slot (header), 56 px in settings, with required alt text; platform placeholder mark = `car` on primary.

## 11. Component inventory (shadcn/ui, `src/ui/components/ui`)
States for every interactive component: default, hover (pointer only), focus-visible (3 px ring, 2 px offset, `--ring`), active/pressed, disabled, plus error and loading where relevant. Disabled by **state or limit** stays visible with `aria-disabled` and a visible reason (still focusable); disabled by **permission** is absent (UX 6.1).

| Component (shadcn) | Variants and sizes | Notes |
|---|---|---|
| Button | default (primary), secondary (muted + border), outline, ghost, destructive, link; sizes sm (44 touch / 36 pointer), default (44), lg (52, public CTA and sticky bar), icon (44 square) | Loading: spinner + changed label ("Saving…"), `aria-disabled`, width kept. Min width of icon-only 44. One primary per screen region. |
| Input, Textarea, Select, Combobox (customer search), Date picker (native `date` + time select), Checkbox, Radio group, RadioCard (font and theme options), Switch (maintenance, email toggle), Label, FormField wrapper | height 44, radius md, border `--input`, text 16 | Error: 2 px danger border + icon + message below (`aria-describedby`, `aria-invalid`); help text 13 px muted; required marked in label text, not asterisk alone. |
| Card | default, selectable, row (list row) | Radius lg, 1 px border, shadow sm. No nested interactive elements: title is the link, buttons are siblings (stretched link allowed). |
| Badge / Chip | neutral, primary, accent, success, warning, danger, info; with icon always | Radius 8, 13 px semibold, icon 14; status chips never colour-only. |
| Alert / Banner | info, warning, danger, success | Icon + text, `role="status"` (banners) or `role="alert"` (errors); actions as links or small buttons; max 2 visible in the shell. |
| Dialog, AlertDialog | default, destructive confirm | Centered, scrim; default focus on the safe action (e.g. "Keep booking"); Esc closes; focus returns to trigger. |
| Sheet (bottom, side) | bottom sheet below md, dialog from md | Grip, title, visible Close 44, sticky footer; focus trapped; background inert. Filters sheet has live count button. |
| Tabs | up to 3 inline; more than 3 become a drill-down list | No horizontally scrolling tab strip. |
| Table | desktop table, phone stacked cards | Sticky header on long lists, sort buttons with `aria-sort`, row title is the link. |
| Pagination | prev / page n of m / next | 25 per page, page in URL. |
| Toast (Sonner) | success only, short | Never the only feedback for errors; errors are inline. |
| Skeleton | line, card, row, calendar rows | Same size as final content; static under reduced motion. |
| Tooltip | default | Never the only carrier of information (touch). |
| Dropdown menu | avatar menu, row actions "More" | Items 44 high on touch. |
| Avatar | initials on secondary | Decorative, name in `aria-label`. |
| Progress | linear for uploads | Text "Uploading 2 of 3". |
| Custom (RentCar) | `VehicleCard`, `SearchBar`, `PriceSummary`, `CodePanel`, `StatusChip`, `CounterTile`, `ListRow` (Today row), `BottomNav`, `Sidebar`, `Fab`, `StickyActionBar`, `CalendarGrid` + `CalendarBar`, `QuickView`, `ContrastPanel`, `ThemePreview`, `ColorField`, `EmptyState`, `ErrorState` | Built only from the tokens above; one file per component under `src/ui`. |

Calendar bar styles (icon + label + border or pattern, never colour only): confirmed = primary-soft fill + 2 px border + `check`; active = primary fill + 6 px top border in foreground + `car`; completed = muted fill + 1 px border + `check`; maintenance = diagonal hatch + dashed border + `wrench`; cancelled = dashed outline, struck text. Today column: primary-soft tint plus filled header with the word "Today".

## 12. Layout patterns per area
- **Public (`/{slug}`)**: top bar 60 (logo or title text, "Contact"); content 16 padding on phone, centered 1120 on desktop; hero (H1 + one line) then a search card (stacked on phone, one row from 768); trust list; footer links (Privacy, Terms, Contact) in the same place on every page. Results: summary bar with "Change dates", sort select and Filters button (sheet below 768, left panel from 768), 1 column (phone), 2 (sm), 3 (lg+) vehicle cards; Select is the only action in the card. Booking form: summary card first, fields stacked, sticky bottom bar (total + Confirm, 76 px) on phone, two columns with summary on the right on desktop. Confirmation: code panel dominates.
- **Tenant admin (`/{slug}/admin`)**: phone = top bar 56 (logo mark, title, avatar menu) + bottom navigation 64 with 5 slots (Today, Calendar, Bookings, Vehicles, More; More only if overflow items) + FAB for "New booking" (admin) bottom 80; md = icon rail; lg = sidebar 240 with groups Operations, Business, Settings; banner region under the top bar (max 2). Form routes hide the bottom nav and use the sticky action bar (Cancel left, Save right). Page padding bottom 100 on phone for FAB and nav clearance.
- **Calendar**: toolbar (prev, Today, next, month button, view select on phone or segmented control on desktop), legend (collapsible on phone), grid with sticky first column (108 phone, wider on desktop) and sticky date header, day columns min 50 (phone) / 58 (desktop), rows min 58. Only the grid scrolls horizontally; opens scrolled so today is visible; Day view is the phone default; quick view is a bottom sheet on phone and a non-modal side panel (300) on desktop.
- **Systemadmin (`/system`)**: hamburger + drawer on phone, sidebar from lg; lists use cards on phone, tables from md; create-tenant is one page of three numbered cards with a sticky action bar.
- **Auth pages**: centered card, tenant logo or platform mark, no navigation.
- **Settings**: drill-down list on phone, left sub-nav on desktop; each page has a sticky [Discard] [Save changes] bar, unsaved-changes guard, "Saved" status. Branding: form column + sticky right column (contrast panel and light/dark previews) on desktop; on phone the panel sits below the colours and previews below the panel.

## 13. Loading, empty, error patterns (S-L, S-E, S-E2, S-R, S-F, S-RO, S-X, S-O, S-T)
- **Loading**: skeleton with the final layout after 300 ms, `aria-busy="true"`, hidden status text "Loading {thing}"; calendar skeleton keeps the sticky column and header; buttons show spinner and "Saving…". Never a full-page spinner for partial loads.
- **Empty (first use)**: 64 px tinted circle with a 24 px icon, H3 reason, one line, one primary action. **Empty (filtered)**: different copy plus "Clear filters". A section with nothing to show on Today is a plain muted line without action.
- **Error (load failed)**: same layout with a danger-soft circle and `triangle-alert`, plain reason, "Try again" button, reference id when available; the rest of the page stays usable (per-section errors).
- **Forbidden / not found**: full page, friendly, link home; same page for cross-tenant ids.
- **Read-only**: persistent banner; write controls visible, `aria-disabled`, with the reason as text.
- **Conflict and stale**: inline banner at the top of the form, data kept, links to the conflicting booking.
- **Offline**: inline error on the failed action with Retry, submitted data kept.
- **Session expired**: dialog over the page, state kept in memory.
- **Validation**: error summary at the top on submit (receives focus) with links to fields, inline message per field with icon, input value kept.

## 14. Dark mode and theme delivery
Light is the default. Dark follows `prefers-color-scheme` unless the tenant forces light or dark (FR-BRD-05). `/{slug}/theme.css?v={themeVersion}` emits `:root` (light), `@media (prefers-color-scheme: dark) :root:not([data-theme])` and `[data-theme=dark]` / `[data-theme=light]` overrides, plus `color-scheme`. Dark is calibrated, not inverted: tinted dark background (about 9.5 percent lightness), cards lighter than the page, shadows heavier, status colours use the lighter dark set, photos get no filter. The contrast gate covers both modes. Images and logos: tenants should provide a logo that works on both; the header logo slot has no background plate in v1 (ASSUMPTION; a light plate can be added if logos fail on dark).

## 15. Focus and accessibility
- Focus ring: 3 px `--ring`, 2 px offset, on every focusable element; never removed; ring has 3:1 against background and card (guaranteed by derivation). Skip link to main content on every page.
- Targets: see section 9; WCAG 2.5.8 minimum 24x24 always; sticky elements budgeted so focus is not obscured (2.4.11).
- Colour is never the only signal (status, today, balance, validation, contrast gate); required text contrast 4.5:1 (3:1 for large text and UI boundaries); border-strong on inputs 3:1.
- Forms: visible labels, `autocomplete` values (given-name, family-name, tel, email, username, current-password, new-password), `inputmode`, errors linked with `aria-describedby`, no CAPTCHA, paste allowed, show/hide password, no confirmation fields (3.3.7, 3.3.8).
- Structure: landmarks (header, nav, main, footer, search), one H1 per page, live regions for result counts, availability and saved states, `aria-current="page"` in navigation.
- Calendar: grid keyboard model per UX 9.3 and an Agenda view as the non-visual equivalent; booking bars have full `aria-label`.
- Motion and zoom: reduced motion honoured; reflow at 320 px (400 percent) except the calendar grid; text resize to 200 percent.
- Verification: axe in Playwright on every main page in light, dark and with the Lemon palette; visual review per milestone in `docs/reviews/ui-<milestone>.md`.

## 16. Tone of voice and microcopy
Plain, short, specific; sentence case; "you" for the user; no jargon, no exclamation marks except in the booking success line. Say what happened, what it means, what to do. Examples (catalogue keys live in `src/messages`, never in code):
- Customer, confirmation: heading "You're all set" with subline "Booking confirmed. Pay at the desk when you pick up the car. Nothing was charged." (friendlier tone borrowed from Warm; the heading stays one line.)
- Errors: "We couldn't load vehicles. Check your connection and try again." Never "Error 500", never blame the user: "Enter a phone number we can call, for example +39 333 123 4567."
- Empty: "No vehicles yet. Add your first vehicle to start taking bookings."
- Destructive: name the object and the consequence, safe button first: "Keep booking" / "Cancel this booking".
- Contrast gate: "Links will use #07819E (4.5:1) so they stay readable." / "Text on background is below 3:1. Fix it to save."
- Buttons: verbs, 1 to 3 words ("Search available vehicles", "Mark paid", "Complete now", "Save changes"); loading: present participle ("Saving…", "Confirming…").
- Numbers: money `€1,234.50` via `Intl`, dates `03 Jun 2026`, 24 h times, always with the tenant time zone note near date fields.

## 17. Images and logos
Vehicle photos: stored as uploaded then served resized (480 and 960 px), cropped `object-fit: cover` at 16:9 in cards, with a neutral placeholder (tinted gradient + `car` icon) when missing; upload guidance in the vehicle form: "Landscape, bright, car centred, 1600 px wide or more." Tenant logo: PNG, JPEG or WebP up to 1 MB, alt text required, shown in a slot 34 px high (header), name text next to it. No stock imagery on the platform pages.

## 18. Implementation notes for the frontend
`tokens.json` generates `src/styles/tokens.css` (platform default, light + dark) and the Tailwind preset through `scripts/build-tokens.ts`; `deriveTheme` + `renderThemeCss` override the same variable names per tenant (ADR-0012). Sources of truth: `tokens.json` for names and platform values, section 4.2 for the algorithm, mockups in `docs/design/clear/` for composition. Visual verification after implementation compares screenshots at 320, 375, 768, 1024, 1280, light and dark, with the Sunny and Lemon palettes.

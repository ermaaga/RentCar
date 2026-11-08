# ADR-0006: PDF engine - @react-pdf/renderer

- Status: accepted
- Date: 2026-11-01 (accepted at GATE 2, 2026-11-01)
- Deciders: user (GATE 2), solution-architect

## Context
Server-side A4 booking summary with tenant branding, embedded fonts, text-searchable, no logo case (FR-PDF-01..05). Must run in Vercel functions (250 MB bundle cap, memory 2 GB default, request duration limits) and in Docker. Generated on demand, not stored (A-30).

## Options considered
1. `@react-pdf/renderer` (pure JS layout engine).
2. Puppeteer/Playwright with headless Chromium (`@sparticuz/chromium` on serverless).
3. `pdfmake` or `pdf-lib` (programmatic).

## Decision
Option 1. Fonts (TTF/OTF of the three allowed families) are shipped as files and registered at render time; bundle inclusion via `outputFileTracingIncludes`. Logos are converted to PNG with `sharp` at upload (react-pdf image support is JPEG/PNG, to confirm in spike S2). Rendering runs in a Node.js route/`after()` task behind a `PdfRenderer` port; the template takes a plain DTO (no DB access).

## Consequences
- Small footprint, no browser binary, predictable on serverless; same output in Docker.
- Layout is limited to react-pdf's flexbox subset; acceptable for a one-page summary.
- Puppeteer rejected: tens of MB binary, multi-second cold starts, memory risk (RAID R-5).
- The port allows replacing the engine later (`pdfmake`) without touching booking code.

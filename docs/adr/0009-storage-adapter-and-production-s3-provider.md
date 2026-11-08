# ADR-0009: Storage adapter and production S3 provider

- Status: accepted for the adapter, upload rules and 4 MB limit; production provider choice stays proposed (deferred to pre-GATE 4; code is provider-agnostic)
- Date: 2026-11-01 (accepted at GATE 2, 2026-11-01; provider part deferred)
- Deciders: user (GATE 2, question ARC-5), solution-architect

## Context
`STORAGE_PROVIDER=local|s3` (AC10). Photos, logos (and generated variants) are public content shown on tenant sites; production must not use local disk; Vercel request bodies are capped at about 4.5 MB (checked 2026-11-01); photos should not be served through usage-billed image optimization.

## Options considered
Adapter: own `StoragePort` (put/get/delete/head, tenant-prefixed keys) with `local` and `s3` implementations (`@aws-sdk/client-s3`, `forcePathStyle` for MinIO).
Production provider:
1. Scaleway Object Storage (Paris), EU company, about EUR 0.0146/GB-month, 75 GB egress free per month (third-party summary of official page, 2026-11-01).
2. Cloudflare R2: free 10 GB, no egress fee, free 1M/10M operations (developers.cloudflare.com, 2026-11-01); US company; EU jurisdiction option to verify.
3. Supabase Storage (S3 protocol, confirmed in docs) when option B is chosen.
4. AWS S3 eu-central-1 / OVH: not costed.

## Decision
Adapter plus Scaleway as recommended production provider; R2 as equivalent alternative; switch by env only. Upload through the app: max 4 MB, magic-byte check, `sharp` re-encode (EXIF stripped, pixel cap), variants 480/1280 px WebP and a PNG logo for PDF, server-generated keys `tenants/{tenantId}/{kind}/{uuid}.{ext}`. Served via `/media/*` with `Cache-Control: public, max-age=31536000, immutable`. Client-side downscale in the form keeps phone photos under the cap (assumption AS-2). `local` provider verifies resolved paths stay inside the base directory and is rejected when running on Vercel. A MinIO Compose profile proves AC10 locally.

## GATE 2 amendment (2026-11-01)
- Accepted: the `StoragePort`, the upload pipeline and the **4 MB per photo limit with client-side downscale** (ARC-4; changes requirement A-23 from 5 MB). Enforcement: client resizes (longest side 2048 px, WebP/JPEG quality ~0.85) before submit; server rejects bodies above 4 MB (`StorageError.TooLarge`) and logos above 1 MB; the limit is a config constant (`UPLOAD_MAX_BYTES`, default 4_194_304) so a self-hosted deployment can raise it, but it must stay below the Vercel body cap (4.5 MB) while Vercel is a candidate.
- Deferred to pre-GATE 4: the production S3 provider (Scaleway recommended, R2 alternative). The code only reads `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`; no provider name appears in code.

## Consequences
- Cost is cents per month at this scale; provider is replaceable.
- Cross-provider migration of existing objects is a documented copy script (not automatic).
- Larger originals are not retained (only re-encoded variants).

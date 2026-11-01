# ADR-0009: Storage adapter and production S3 provider

- Status: proposed
- Date: 2026-11-01
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

## Consequences
- Cost is cents per month at this scale; provider is replaceable.
- Cross-provider migration of existing objects is a documented copy script (not automatic).
- Larger originals are not retained (only re-encoded variants).

---
name: stack
description: Technology stack, library choices, and the reasoning behind them. Load when working with specific technologies or making decisions about libraries and tools.
triggers:
  - "library"
  - "package"
  - "dependency"
  - "which tool"
  - "technology"
edges:
  - target: context/decisions.md
    condition: when the reasoning behind a tech choice is needed
  - target: context/conventions.md
    condition: when understanding how to use a technology in this codebase
  - target: context/architecture.md
    condition: when understanding how a library fits into the system flow
last_updated: 2026-06-25
---

# Stack

## Core Technologies

- **next** 14 (App Router) — web framework; all pages and API routes use App Router conventions; no Pages Router
- **Node.js 20+** — runtime; `server.js` wraps Next.js with graceful SIGTERM handling for PM2
- **TypeScript 5.6** — all source files; `@/` path alias maps to project root
- **PostgreSQL** — sole persistent database; Prisma manages schema and migrations
- **vitest** — test runner (not Jest); config at `vitest.config.ts`

## Key Libraries

- **prisma** 6 (not raw SQL) — ORM for all DB access; import via `import { prisma } from "@/lib/db"`, never `new PrismaClient()`
- **zod** 3 — validation everywhere; mandatory for all LLM output parsing before persisting to DB
- **@shopify/shopify-api** — Shopify API client and App Bridge session token verification
- **@shopify/app-bridge-react** — Shopify embedded app React hooks and session token provider
- **@shopify/polaris** 13 — all UI components; no custom component library or Tailwind
- **openai** — used for both DeepSeek and OpenRouter calls (both expose OpenAI-compatible APIs); `lib/ai/client.ts` selects the active provider
- **better-sqlite3** — local-only for competitor scraper DB (`SCRAPER_DB_PATH`); not used in the main app database
- **p-limit** — concurrency control in batch/parallel operations (e.g. multi-skill runs)

## What We Deliberately Do NOT Use

- **No Redux / Zustand** — all UI state is local React hooks + Polaris; no global state manager
- **No Vercel / serverless deployment** — self-hosted on Linode VPS with PM2; the `export const maxDuration` in cron routes is vestigial Vercel config, not active
- **No Klaviyo in active code** — connector exists but is dead; do not extend or depend on it
- **No Google Ads campaign writes** — `google-ads-api` package is used read-only for keyword planning only

## Version Constraints

- **Next.js 14 App Router only** — no `getServerSideProps`, `getStaticProps`, or any Pages Router patterns; every route file exports named `GET`/`POST`/etc. handlers
- **Prisma 6** — migration CLI syntax differs slightly from v5; use `npm run db:migrate` (wraps `prisma migrate deploy`), not raw CLI invocations

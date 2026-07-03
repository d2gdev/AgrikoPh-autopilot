# Development Guide

## Local Setup

```bash
git clone <repo>
cd autopilot-app
cp .env.example .env.local
```

Fill in `.env.local`. Minimum required for local development:

```
DATABASE_URL=postgresql://localhost:5432/autopilot
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_ADMIN_ACCESS_TOKEN=...
SHOPIFY_APP_URL=https://your-ngrok-url.ngrok.io
SHOPIFY_STORE_DOMAIN=e56aau-5f.myshopify.com
NEXT_PUBLIC_SHOPIFY_API_KEY=...
SCOPES=read_orders,read_products,read_analytics
OPENROUTER_API_KEY=...
CREDENTIALS_ENCRYPTION_KEY=<32-byte hex: openssl rand -hex 32>
CRON_SECRET=<any string>
```

Connector keys (Meta, Google Ads, GA4, etc.) are optional — the app runs without them, returning empty data for those pilots.

## Shopify Admin Token

Do not refresh Shopify theme/app credentials through an interactive Shopify CLI login. Use the project command:

```bash
npm run shopify:refresh-token
```

The old shorthand is supported too:

```bash
npm run shopify:token
```

This generates a fresh Shopify Admin API access token from `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`, writes it to the local app/theme `.env` files, updates the production server env, syncs the DB-backed `ApiCredential` override, verifies the DB override still matches the server env token, restarts PM2, and validates Shopify Admin API access without printing the token.

To check current token health without generating a new token:

```bash
npm run shopify:check-token
```

The check validates local app/theme env files, production server env, the production DB-backed credential override, and production health. It exits non-zero if the DB credential and env token do not match.

For local-only updates:

```bash
npm run shopify:refresh-token -- --local-only
```

## Database

```bash
# Create and migrate the local database
npx prisma migrate dev

# Seed default guardrail config
npm run db:seed

# Prisma Studio (visual DB browser)
npx prisma studio
```

To create a new migration after editing `prisma/schema.prisma`:
```bash
npx prisma migrate dev --name describe-your-change
```

## Running Locally

```bash
npm run dev     # starts Next.js on http://localhost:3000
```

## Local Production Builds

```bash
npm run build:local  # optimized local production build
npm run build:clean  # force Prisma Client regeneration before building
```

`npm run build` uses the same optimized wrapper as `build:local`: it disables Next telemetry, skips Prisma Client generation when `prisma/schema.prisma` and package inputs are unchanged, and skips build-time lint. Run `npm run typecheck:test` or `npm run lint` separately when you need validation.

**Shopify session auth requires a public URL.** The embedded app loads inside Shopify admin and App Bridge verifies the session token against the app's public URL. Use ngrok:

```bash
ngrok http 3000
# copy the https://... URL into SHOPIFY_APP_URL in .env.local
```

**Cron routes** can be triggered manually without a scheduler:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/fetch-ads-data
```

## Tests

**Runner:** [Vitest](https://vitest.dev/)

```bash
npm test              # run all tests once
npm run test:watch    # watch mode (re-runs on file changes)
npm run test:coverage # coverage report
```

**Coverage scope:** `lib/**` and `jobs/**` only — API route handlers are excluded.

**Test files:**
```
__tests__/
├── lib/
│   ├── auth.test.ts
│   ├── crypto.test.ts          5 tests: round-trip, random IV, tamper detection, missing key
│   ├── executor.test.ts
│   ├── guardrails.test.ts      8 tests with Prisma mock
│   └── skills/
│       └── runner.test.ts      9 tests
└── jobs/
    ├── execute-approved.test.ts
    ├── fetch-blog-content.test.ts
    └── run-skills.test.ts
```

**Mocking pattern:** Prisma is mocked via `vi.mock('@/lib/db')` — tests never hit a real database.

## Adding a New Connector

1. Create `lib/connectors/myservice.ts` — export an async function returning a typed snapshot object
2. Add required env vars to `.env.example` and `lib/validate-env.ts` (if required at startup)
3. Call it from an existing job (`jobs/fetch-ads-data.ts`) or create a new job file
4. Add a cron route at `app/api/cron/fetch-myservice-data/route.ts`
5. Register the cron schedule in `vercel.json`
6. Document the new connector in `autopilot.md` (Data Connectors table)

## Adding a New Skill

Skills are pure Markdown — no code changes needed.

1. Create a `.md` file in `skills-source/` with this frontmatter:
   ```yaml
   ---
   title: My Skill Name
   platform: meta        # meta | google_ads | both
   enabled: true
   ---
   ```
2. Write the skill prompt in the body — describe what the AI should analyse and recommend
3. The loader picks it up automatically on next `run-skills` job run

**Supported platforms:** `meta`, `google_ads`, `both`. Skills with `linkedin`, `reddit`, or `seo` platform will load but never be dispatched (logged as warnings).

**Root-level files win** over identically-named files in subdirectories (deduplication).

# Autopilot App — Orchestration Tasks

## Design Notes

### Cron Architecture

All 6 cron routes are scheduled at hourly intervals (1–6am UTC) by an external scheduler that calls the `/api/cron/*` routes with `Authorization: Bearer $CRON_SECRET` (see `docs/CRON.md`):

| Time (UTC) | Route |
|---|---|
| 01:00 | `/api/cron/daily` — full pipeline: fetch + skills |
| 02:00 | `/api/cron/run-skills` |
| 03:00 | `/api/cron/fetch-blog-content` |
| 04:00 | `/api/cron/fetch-seo-data` |
| 05:00 | `/api/cron/fetch-ads-data` |
| 06:00 | `/api/cron/execute-approved` |

Each route is also individually HTTP-accessible with `CRON_SECRET` for partial pipeline runs and debugging.
See `docs/CRON.md` for full details.

### ApiCredential Encryption

**Implemented.** `lib/crypto.ts` provides AES-256-GCM encrypt/decrypt.
All `ApiCredential.value` fields are encrypted at write and decrypted at read via `/api/settings/credentials`.
`CREDENTIALS_ENCRYPTION_KEY` is required at startup — see `.env.example`.

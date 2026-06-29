---
name: credentials
description: Credential resolution hierarchy, encryption, and token auto-refresh
metadata:
  type: project
---

# Credentials

## Resolution hierarchy (`lib/config/resolver.ts`)

`getSecret(key)` / `getOptionalSecret(key)`:
1. Query `ApiCredential` DB table (decrypted with AES-256-GCM)
2. Fall back to `process.env[key]`
3. Throw if missing (for `getSecret`)

DB row takes permanent precedence over `.env` once it exists. The `.env` file is fallback only — never modify it from running app code.

## Encryption (`lib/crypto.ts`)

- Algorithm: AES-256-GCM, 12-byte random IV per write
- Key: SHA-256 of `CREDENTIALS_ENCRYPTION_KEY` env var (≥32 chars)
- Format: base64(`IV[12] + AuthTag[16] + ciphertext`)
- Do NOT change key derivation without a migration script (would break all existing DB rows)

## Shopify token auto-refresh (`lib/connectors/shopify-token.ts`)

- Shopify admin tokens expire every 24h (OAuth `client_credentials` flow)
- `refreshAndStoreShopifyToken()` exchanges `SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET` for a fresh token and upserts it into `ApiCredential`
- `lib/shopify-admin.ts` catches 401 → calls refresh → retries once automatically
- `_refreshInFlight` deduplicate guard (module-level — per-process only)

## Settings UI

`PUT /api/settings/credentials/[key]` — encrypts then upserts. `GET` returns masked only, never decrypts. Requires Shopify session auth.

## Key credential names

| Key | Source |
|-----|--------|
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | DB (auto-refreshed) |
| `SHOPIFY_STORE_DOMAIN` | .env |
| `SHOPIFY_API_KEY` | .env |
| `SHOPIFY_API_SECRET` | .env |
| `META_ACCESS_TOKEN` | DB |
| `META_AD_ACCOUNT_ID` | DB |
| `META_TOKEN_EXPIRES_AT` | .env (warning display only) |
| `CREDENTIALS_ENCRYPTION_KEY` | .env (never DB) |
| `DATABASE_URL` | .env |

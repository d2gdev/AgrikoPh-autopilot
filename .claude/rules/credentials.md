---
paths:
  - "lib/credentials/**"
  - "app/api/settings/**"
  - "lib/connectors/**"
---
Credential resolver checks DB before `.env` — never write secrets to `.env` from running code.
Shopify admin token auto-refreshes on 401 — no manual intervention needed.

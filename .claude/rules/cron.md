---
paths:
  - "app/api/cron/**"
---
All cron routes require `Authorization: Bearer $CRON_SECRET` — fails closed if unset.
`EXECUTE_APPROVED_LIVE_ENABLED=true` on prod — the execute-approved cron is live.

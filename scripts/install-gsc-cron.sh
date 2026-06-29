#!/usr/bin/env bash
# Installs (or repairs) the weekly GSC cron entry in /etc/cron.d/autopilot.
# Idempotent: removes any prior fetch-gsc-data line first, then appends a clean one.
# Run on the prod host as root:  bash /opt/autopilot/scripts/install-gsc-cron.sh
set -e
F=/etc/cron.d/autopilot
cp "$F" "$F.bak.$(date +%s)" 2>/dev/null || true

# Drop any existing fetch-gsc-data line (including the broken "rtk curl" one).
sed -i '/fetch-gsc-data/d' "$F"

# Append the correct weekly entry (Mondays 05:50). Mirrors the other cron lines.
LINE="50 5 * * 1 root SECRET=\$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '\"'); curl -sf https://autopilot.agrikoph.com/api/cron/fetch-gsc-data -H \"Authorization: Bearer \$SECRET\" >> /var/log/autopilot-cron.log 2>&1"
printf '%s\n' "$LINE" >> "$F"

echo "GSC cron entry installed:"
grep -n "fetch-gsc-data" "$F"
echo "rtk lines remaining (should be none):"
grep -n "rtk" "$F" || echo "  (none)"

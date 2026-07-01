/**
 * Deploy app updates to Linode.
 * Run: node scripts/linode-deploy.mjs
 */

import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const DOMAIN = process.env.AUTOPILOT_DOMAIN || 'autopilot.agrikoph.com';

// Read server IP (saved by provision script, or override with env)
const ipFile = resolve(__dir, '.linode-ip');
const IP = process.env.LINODE_IP
  || (existsSync(ipFile) ? readFileSync(ipFile, 'utf8').trim() : null);

if (!IP) {
  console.error('No Linode IP found. Set LINODE_IP env var or run linode-provision.mjs first.');
  process.exit(1);
}

function expandHome(value) {
  return value.startsWith('~/') ? `${process.env.HOME}/${value.slice(2)}` : value;
}

function resolveSshKey() {
  if (process.env.SSH_KEY) {
    const explicit = expandHome(process.env.SSH_KEY);
    if (!existsSync(explicit)) {
      console.error(`SSH_KEY was set, but the key file does not exist: ${explicit}`);
      process.exit(1);
    }
    return explicit;
  }

  const candidates = [
    `${process.env.HOME}/.ssh/autopilot_deploy`,
    `${process.env.HOME}/.ssh/id_ed25519_autopilot`,
    `${process.env.HOME}/.ssh/id_ed25519`,
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const SSH_KEY = resolveSshKey();
const SSH_OPTS = ['-o', 'StrictHostKeyChecking=no', ...(SSH_KEY ? ['-i', SSH_KEY] : [])];
const RSYNC_SSH = ['ssh', ...SSH_OPTS].map(shellQuote).join(' ');

console.log(SSH_KEY ? `Using SSH key ${SSH_KEY}` : 'Using default SSH agent/config keys');

function ssh(cmd) {
  const result = spawnSync('ssh', [
    ...SSH_OPTS,
    `root@${IP}`,
    cmd,
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`SSH failed: ${cmd}`);
}

function rsync(localPath, remotePath, extra = []) {
  const result = spawnSync('rsync', [
    '-az', '--delete', '--progress',
    '-e', RSYNC_SSH,
    ...extra,
    localPath,
    `root@${IP}:${remotePath}`,
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('rsync failed');
}

console.log(`\nDeploying to ${IP}...\n`);

console.log('==> Syncing files...');
rsync(`${ROOT}/`, '/opt/autopilot/', [
  '--exclude=node_modules',
  '--exclude=.next',
  '--exclude=tmp',
  '--exclude=tsconfig.tsbuildinfo',
  '--exclude=.git',
  '--exclude=.claude',
  '--exclude=.env',           // never overwrite server-owned env
  '--exclude=.env.local',
  '--exclude=.env.production',
  '--exclude=scripts/gen-lang-client-google-ads.json',
  '--exclude=scripts/.linode-ip',
  '--exclude=scripts/.linode-id',
]);

console.log('\n==> Removing stale local-only env files...');
ssh('cd /opt/autopilot && rm -f .env.local .env.production');

console.log('\n==> Ensuring build swap is available...');
ssh('if [ ! -f /swapfile-autopilot ]; then fallocate -l 2G /swapfile-autopilot || dd if=/dev/zero of=/swapfile-autopilot bs=1M count=2048; chmod 600 /swapfile-autopilot; mkswap /swapfile-autopilot; grep -q "^/swapfile-autopilot " /etc/fstab || echo "/swapfile-autopilot none swap sw 0 0" >> /etc/fstab; fi; swapon /swapfile-autopilot 2>/dev/null || true');

console.log('\n==> Installing dependencies...');
// Use npm install (not npm ci) to preserve compiled native addons (better-sqlite3).
// npm ci does a clean wipe + rebuild which fails without full build toolchain on the VPS.
ssh('mkdir -p /opt/autopilot/.npm-cache; cd /opt/autopilot && bash --norc --noprofile -c \'set -o pipefail; npm install --prefer-offline --no-audit --no-fund --cache /opt/autopilot/.npm-cache 2>&1 | tail -20\'');

console.log('\n==> Applying database migrations...');
ssh('cd /opt/autopilot && bash --norc --noprofile -c \'set -a; source .env; set +a; npm run db:migrate\'');

console.log('\n==> Updating cron schedule...');
const cronContent = `SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 1 * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf https://${DOMAIN}/api/cron/daily -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
0 3 * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf https://${DOMAIN}/api/cron/fetch-blog-content -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
0 4 * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf https://${DOMAIN}/api/cron/fetch-seo-data -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
30 4 * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf https://${DOMAIN}/api/cron/snapshot-seo-history -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
0 5 * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf https://${DOMAIN}/api/cron/fetch-ads-data -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
30 5 * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf https://${DOMAIN}/api/cron/fetch-market-intel -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
45 5 * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf https://${DOMAIN}/api/cron/fetch-keyword-research -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
50 5 * * 1 root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf https://${DOMAIN}/api/cron/fetch-gsc-data -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
0 6 * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf "https://${DOMAIN}/api/cron/execute-approved?dryRun=true" -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
30 6 * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf https://${DOMAIN}/api/cron/index-knowledge -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
* * * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf "https://${DOMAIN}/api/cron/drain-jobs?limit=1" -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
*/15 * * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf https://${DOMAIN}/api/cron/publish-scheduled -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
`;
ssh(`cat > /etc/cron.d/autopilot <<'EOF'
${cronContent}EOF
chmod 644 /etc/cron.d/autopilot && systemctl restart cron`);

console.log('\n==> Preparing staging build with warm cache...');
ssh('cd /opt/autopilot && rm -rf .next.build && mkdir -p .next.build && if [ -d .next/cache ]; then mkdir -p .next.build/cache && cp -a .next/cache/. .next.build/cache/; fi');

console.log('\n==> Building into .next.build (staging dir)...');
ssh('cd /opt/autopilot && bash --norc --noprofile -c \'set -o pipefail; set -a; source .env; set +a; NEXT_OUTPUT_DIR=.next.build npm run build:remote 2>&1 | tail -60\' || (rm -rf /opt/autopilot/.next.build; exit 1)');

console.log('\n==> Swapping build dirs atomically...');
ssh('cd /opt/autopilot && rm -rf .next.old && (mv .next .next.old 2>/dev/null || true) && mv .next.build .next');

console.log('\n==> Restarting app...');
ssh('pm2 restart autopilot --update-env || pm2 start /opt/autopilot/ecosystem.config.js');

console.log('\n==> Cleaning up old build...');
ssh('rm -rf /opt/autopilot/.next.old /opt/autopilot/.next.build');

console.log('\n✓ Deploy complete\n');

/**
 * Step 2: Set up the server and deploy the app.
 * Run AFTER adding the Cloudflare A record:
 *   node scripts/linode-setup.mjs
 */

import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');
const DOMAIN = 'autopilot.agrikoph.com';
const EMAIL  = 'kathrynlynn1313@gmail.com';

const ipFile = resolve(__dir, '.linode-ip');
if (!existsSync(ipFile)) {
  console.error('No .linode-ip file found. Run linode-provision.mjs first.');
  process.exit(1);
}
const IP = readFileSync(ipFile, 'utf8').trim();
console.log(`\nSetting up server at ${IP}...\n`);

function ssh(cmd, opts = {}) {
  const result = spawnSync('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=15',
    `root@${IP}`, cmd,
  ], { stdio: opts.silent ? ['pipe','pipe','pipe'] : 'inherit', encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && !opts.ignoreError) throw new Error(`SSH failed (${result.status}): ${cmd.slice(0, 80)}`);
  return result.stdout ?? '';
}

function sshScript(lines) {
  const script = '#!/bin/bash\nset -e\n' + lines.join('\n');
  const write = spawnSync('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    `root@${IP}`, 'cat > /tmp/s.sh && chmod +x /tmp/s.sh',
  ], { input: script, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
  if (write.error) throw write.error;
  if (write.status !== 0) throw new Error('Failed to write script: ' + write.stderr);
  const run = spawnSync('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    `root@${IP}`, 'bash /tmp/s.sh',
  ], { stdio: 'inherit' });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error('Script failed');
}

function rsync(localPath, remotePath, exclude = []) {
  const args = [
    '-az',
    '--delete',
    '-e', 'ssh -o StrictHostKeyChecking=no',
    ...exclude.map(e => `--exclude=${e}`),
    localPath,
    `root@${IP}:${remotePath}`,
  ];
  const r = spawnSync('rsync', args, { stdio: ['ignore','pipe','pipe'], encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('rsync failed: ' + r.stderr);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // 1. Install dependencies
  console.log('==> Installing server dependencies...');
  sshScript([
    'export DEBIAN_FRONTEND=noninteractive',
    'apt-get update -q',
    'apt-get upgrade -y -q',
    'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -',
    'apt-get install -y nodejs nginx certbot python3-certbot-nginx rsync build-essential python3',
    'npm install -g pm2',
    'mkdir -p /opt/autopilot',
    'if [ ! -f /swapfile-autopilot ]; then fallocate -l 2G /swapfile-autopilot || dd if=/dev/zero of=/swapfile-autopilot bs=1M count=2048; chmod 600 /swapfile-autopilot; mkswap /swapfile-autopilot; grep -q "^/swapfile-autopilot " /etc/fstab || echo "/swapfile-autopilot none swap sw 0 0" >> /etc/fstab; fi',
    'swapon /swapfile-autopilot 2>/dev/null || true',
    'echo "✓ Dependencies installed"',
    'node --version',
    'pm2 --version',
  ]);

  // 2. Nginx config
  console.log('\n==> Configuring Nginx...');
  const nginxConf = `server {
    listen 80;
    server_name ${DOMAIN};
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        client_max_body_size 10M;
    }
}`;
  const writeNginx = spawnSync('ssh', [
    '-o', 'StrictHostKeyChecking=no', `root@${IP}`,
    'cat > /etc/nginx/sites-available/autopilot',
  ], { input: nginxConf, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
  if (writeNginx.status !== 0) throw new Error('Failed to write nginx config');

  ssh('ln -sf /etc/nginx/sites-available/autopilot /etc/nginx/sites-enabled/autopilot && rm -f /etc/nginx/sites-enabled/default && nginx -t && systemctl restart nginx && echo "✓ Nginx configured"');

  // 3. Sync app files
  console.log('\n==> Syncing app files...');
  rsync(`${ROOT}/`, '/opt/autopilot/', [
    'node_modules', '.next', '.git', '.env', '.env.local', '.env.production', 'scripts/.linode-ip', 'scripts/.linode-id',
  ]);
  ssh('cd /opt/autopilot && rm -f .env.local .env.production');
  console.log('✓ Files synced');

  // 4. Write .env
  console.log('\n==> Writing production .env...');
  const envContent = readFileSync(resolve(ROOT, '.env'), 'utf8')
    .replace(/SHOPIFY_APP_URL=.*/, `SHOPIFY_APP_URL="https://${DOMAIN}"`)
    .replace(/LINODE_API_TOKEN=.*\n?/, '');
  const writeEnv = spawnSync('ssh', [
    '-o', 'StrictHostKeyChecking=no', `root@${IP}`,
    'cat > /opt/autopilot/.env',
  ], { input: envContent, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
  if (writeEnv.status !== 0) throw new Error('Failed to write .env');
  console.log('✓ .env written');

  // 5. Install deps + build
  console.log('\n==> Installing npm dependencies...');
  sshScript([
    'cd /opt/autopilot',
    'mkdir -p /opt/autopilot/.npm-cache',
    'npm install --prefer-offline --no-audit --no-fund --cache /opt/autopilot/.npm-cache 2>&1 | tail -20',
  ]);

  console.log('\n==> Building Next.js app...');
  sshScript([
    'cd /opt/autopilot',
    'set -a; source .env; set +a',
    'npm run build:remote 2>&1 | tail -60',
  ]);

  // 6. Start PM2
  console.log('\n==> Starting app with PM2...');
  sshScript([
    'cd /opt/autopilot',
    'pm2 delete autopilot 2>/dev/null || true',
    'pm2 start npm --name autopilot -- start',
    'pm2 save',
    'env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root | tail -1 | bash || true',
    'echo "✓ PM2 started"',
  ]);

  // 7. SSL
  console.log('\n==> Obtaining SSL certificate (requires DNS to be propagated)...');
  sshScript([
    `certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m ${EMAIL} --redirect`,
    'echo "✓ SSL configured"',
  ]);

  // 8. Cron
  console.log('\n==> Setting up cron jobs...');
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
* * * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf "https://${DOMAIN}/api/cron/drain-jobs?limit=1" -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
*/15 * * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf https://${DOMAIN}/api/cron/publish-scheduled -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
`;
  const writeCron = spawnSync('ssh', [
    '-o', 'StrictHostKeyChecking=no', `root@${IP}`,
    'cat > /etc/cron.d/autopilot && chmod 644 /etc/cron.d/autopilot && systemctl restart cron',
  ], { input: cronContent, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
  if (writeCron.status !== 0) throw new Error('Failed to write cron');
  console.log('✓ Cron configured');

  console.log(`
${'='.repeat(60)}
✓ autopilot-app is live at https://${DOMAIN}

Next steps:
1. Update Shopify Partners Dashboard app URL to:
   https://${DOMAIN}

2. Future deploys:
   node scripts/linode-deploy.mjs
${'='.repeat(60)}
`);
}

main().catch(err => { console.error('\n✗ Setup failed:', err.message); process.exit(1); });

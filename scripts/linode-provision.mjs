/**
 * Step 1: Create the Linode and print the IP.
 * Run: node scripts/linode-provision.mjs
 *
 * After this completes:
 *  1. Add A record in Cloudflare: autopilot.agrikoph.com → <IP>  (DNS only, grey cloud)
 *  2. Run: node scripts/linode-setup.mjs
 */

import { request as httpsRequest } from 'https';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

const LINODE_TOKEN = readFileSync(resolve(ROOT, '.env'), 'utf8')
  .match(/LINODE_API_TOKEN=["']?([^"'\n]+)["']?/)?.[1]?.trim();

const REGION = 'ap-southeast'; // Singapore
const TYPE   = 'g6-standard-1'; // 2GB RAM $12/mo
const IMAGE  = 'linode/ubuntu22.04';
const LABEL  = 'autopilot-app';

if (!LINODE_TOKEN) { console.error('LINODE_API_TOKEN not found in .env'); process.exit(1); }

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.linode.com',
      path: `/v4${path}`,
      method,
      headers: {
        Authorization: `Bearer ${LINODE_TOKEN}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = httpsRequest(opts, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getSshPublicKey() {
  const { spawnSync } = require('child_process');
  for (const p of [`${process.env.HOME}/.ssh/id_ed25519.pub`, `${process.env.HOME}/.ssh/id_rsa.pub`]) {
    if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  }
  // Generate one
  const { execSync } = require('child_process');
  execSync(`ssh-keygen -t ed25519 -N "" -f "${process.env.HOME}/.ssh/id_ed25519" -C "autopilot-linode"`, { stdio: 'inherit' });
  return readFileSync(`${process.env.HOME}/.ssh/id_ed25519.pub`, 'utf8').trim();
}

async function main() {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const { execSync } = require('child_process');

  // Check if already provisioned
  const ipFile = resolve(__dir, '.linode-ip');
  if (existsSync(ipFile)) {
    const ip = readFileSync(ipFile, 'utf8').trim();
    console.log(`\nLinode already provisioned at ${ip}`);
    console.log('Run: node scripts/linode-setup.mjs');
    return;
  }

  const pubKey = (() => {
    for (const p of [`${process.env.HOME}/.ssh/id_ed25519.pub`, `${process.env.HOME}/.ssh/id_rsa.pub`]) {
      if (existsSync(p)) return readFileSync(p, 'utf8').trim();
    }
    execSync(`ssh-keygen -t ed25519 -N "" -f "${process.env.HOME}/.ssh/id_ed25519" -C "autopilot-linode"`, { stdio: 'inherit' });
    return readFileSync(`${process.env.HOME}/.ssh/id_ed25519.pub`, 'utf8').trim();
  })();

  console.log('\n==> Creating Linode (2GB, Singapore)...');
  const { status, body: linode } = await api('POST', '/linode/instances', {
    label: LABEL,
    region: REGION,
    type: TYPE,
    image: IMAGE,
    root_pass: randomBytes(24).toString('base64'),
    authorized_keys: [pubKey],
    booted: true,
  });

  if (status !== 200) {
    console.error('Failed to create Linode:', JSON.stringify(linode, null, 2));
    process.exit(1);
  }

  const linodeId = linode.id;
  const ip = linode.ipv4[0];

  writeFileSync(ipFile, ip);
  writeFileSync(resolve(__dir, '.linode-id'), String(linodeId));

  console.log('==> Waiting for Linode to boot...');
  for (let i = 0; i < 30; i++) {
    await sleep(10000);
    const { body: inst } = await api('GET', `/linode/instances/${linodeId}`);
    process.stdout.write(`   status: ${inst.status}\r`);
    if (inst.status === 'running') { console.log('\n✓ Running'); break; }
  }

  console.log(`
${'='.repeat(60)}
✓ Linode created!

  ID:  ${linodeId}
  IP:  ${ip}

ACTION: Add this DNS record in Cloudflare now:
  Type:   A
  Name:   autopilot
  Value:  ${ip}
  Proxy:  DNS only (grey cloud)

When done, run:
  node scripts/linode-setup.mjs
${'='.repeat(60)}
`);
}

main().catch(err => { console.error(err); process.exit(1); });

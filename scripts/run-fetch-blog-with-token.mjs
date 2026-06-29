/**
 * Backfill runner — refreshes Shopify OAuth token from shopify-theme/.env,
 * then runs the fetch-blog-content job directly against Neon.
 * Run: node scripts/run-fetch-blog-with-token.mjs
 */
import https from 'https';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Load env from both projects ───────────────────────────────────────────────
function loadEnv(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8').split('\n')
      .filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => {
        const i = l.indexOf('=');
        const key = l.slice(0, i).trim();
        let val = l.slice(i + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        return [key, val];
      })
  );
}

const themeEnv = loadEnv('/mnt/c/Users/Sean/Documents/Agriko/cinema/shopify-theme/.env');
const autopilotEnv = loadEnv(resolve(__dir, '../.env'));

const STORE = themeEnv.SHOPIFY_STORE_DOMAIN;
const API_KEY = themeEnv.SHOPIFY_API_KEY;
const API_SECRET = themeEnv.SHOPIFY_API_SECRET;
const DATABASE_URL = autopilotEnv.DATABASE_URL;

// ── Refresh OAuth token ───────────────────────────────────────────────────────
const body = new URLSearchParams({
  grant_type: 'client_credentials',
  client_id: API_KEY,
  client_secret: API_SECRET,
}).toString();

const freshToken = await new Promise((resolve, reject) => {
  const u = new URL(`https://${STORE}/admin/oauth/access_token`);
  const req = https.request({
    hostname: u.hostname, path: u.pathname, method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => {
      const j = JSON.parse(d);
      if (j.access_token) resolve(j.access_token);
      else reject(new Error(`Token refresh failed: ${d}`));
    });
  });
  req.on('error', reject);
  req.write(body); req.end();
});

console.log('[runner] Token refreshed.');

// ── Run the TypeScript job via tsx with injected env ─────────────────────────
const child = spawn(
  'npx', ['tsx', 'scripts/run-fetch-blog.ts'],
  {
    cwd: resolve(__dir, '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL,
      SHOPIFY_STORE_DOMAIN: STORE,
      SHOPIFY_ADMIN_ACCESS_TOKEN: freshToken,
    },
  }
);

child.on('exit', code => process.exit(code ?? 0));

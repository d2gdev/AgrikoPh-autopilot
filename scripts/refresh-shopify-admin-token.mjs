#!/usr/bin/env node

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

const DEFAULTS = {
  appEnv: resolve(ROOT, ".env"),
  themeEnv: resolve(ROOT, "../cinema/shopify-theme/.env"),
  server: "autopilot-prod",
  serverAppDir: "/opt/autopilot",
  serverEnv: "/opt/autopilot/.env",
  healthUrl: "https://autopilot.agrikoph.com/api/health",
};

function usage() {
  console.log(`Refresh Shopify Admin API access token.

Usage:
  npm run shopify:refresh-token
  npm run shopify:token
  npm run shopify:check-token
  node scripts/refresh-shopify-admin-token.mjs [options]

Options:
  --check-only          Validate current env/DB tokens without refreshing or writing.
  --local-only          Update local env files and local DB only.
  --no-local-db         Do not sync local ApiCredential.
  --no-server-db        Do not sync server ApiCredential.
  --no-restart          Do not restart PM2 after updating server env.
  --app-env <path>      Local autopilot env path. Default: ${DEFAULTS.appEnv}
  --theme-env <path>    Local Shopify theme env path. Default: ${DEFAULTS.themeEnv}
  --server <host>       SSH host alias. Default: ${DEFAULTS.server}
  --server-env <path>   Server env path. Default: ${DEFAULTS.serverEnv}
  --server-dir <path>   Server app directory. Default: ${DEFAULTS.serverAppDir}
  --health-url <url>    Health URL checked after restart.
  --help                Show this help.

The token is never printed. Status output shows only HTTP codes and token length.`);
}

function parseArgs(argv) {
  const options = {
    appEnv: DEFAULTS.appEnv,
    themeEnv: DEFAULTS.themeEnv,
    server: DEFAULTS.server,
    serverAppDir: DEFAULTS.serverAppDir,
    serverEnv: DEFAULTS.serverEnv,
    healthUrl: DEFAULTS.healthUrl,
    localOnly: false,
    syncLocalDb: true,
    syncServerDb: true,
    restart: true,
    checkOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };

    switch (arg) {
      case "--help":
      case "-h":
        usage();
        process.exit(0);
      case "--local-only":
        options.localOnly = true;
        break;
      case "--check-only":
        options.checkOnly = true;
        options.restart = false;
        break;
      case "--no-local-db":
        options.syncLocalDb = false;
        break;
      case "--no-server-db":
        options.syncServerDb = false;
        break;
      case "--no-restart":
        options.restart = false;
        break;
      case "--app-env":
        options.appEnv = resolve(next());
        break;
      case "--theme-env":
        options.themeEnv = resolve(next());
        break;
      case "--server":
        options.server = next();
        break;
      case "--server-env":
        options.serverEnv = next();
        break;
      case "--server-dir":
        options.serverAppDir = next();
        break;
      case "--health-url":
        options.healthUrl = next();
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function loadEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
  );
}

function updateEnvFile(file, key, value) {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const next = pattern.test(text)
    ? text.replace(pattern, line)
    : text.replace(/\s*$/, `\n${line}\n`);

  if (next !== text) writeFileSync(file, next, "utf8");
}

function normalizeStoreDomain(value) {
  return String(value || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function encryptionKey(raw) {
  if (!raw) throw new Error("CREDENTIALS_ENCRYPTION_KEY is required for ApiCredential sync");
  if (raw.length < 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must be at least 32 characters");
  }
  return createHash("sha256").update(raw).digest();
}

function encryptCredential(plaintext, keySource) {
  const key = encryptionKey(keySource);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptCredential(ciphertext, keySource) {
  const key = encryptionKey(keySource);
  const payload = Buffer.from(ciphertext, "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

async function refreshToken({ store, apiKey, apiSecret }) {
  const response = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: apiKey,
      client_secret: apiSecret,
    }).toString(),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(`Shopify token refresh failed: HTTP ${response.status} ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function validateToken({ store, apiVersion, token, label }) {
  if (!token) throw new Error(`${label} SHOPIFY_ADMIN_ACCESS_TOKEN is missing`);
  const response = await fetch(`https://${store}/admin/api/${apiVersion}/shop.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!response.ok) throw new Error(`${label} Shopify Admin API check failed: HTTP ${response.status}`);
  console.log(`[${label}] Shopify Admin API check HTTP ${response.status}.`);
}

function assertMatch({ left, right, label }) {
  if (!left || !right) return;
  const matches = left === right;
  console.log(`${label}=${matches ? "yes" : "no"}`);
  if (!matches) throw new Error(`${label}=no`);
}

function assertEnvFileToken({ envPath, token, label }) {
  if (!existsSync(envPath)) {
    console.log(`[${label}] Skipped missing file: ${envPath}`);
    return;
  }

  const env = loadEnv(envPath);
  const envToken = env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
  assertMatch({ left: envToken, right: token, label: `[${label}] matches_new_token` });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function run(command, args, { input, label } = {}) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    stdio: input == null ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(`${label || command} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function syncLocalDb({ envPath, token }) {
  const env = loadEnv(envPath);
  if (!env.DATABASE_URL || !env.CREDENTIALS_ENCRYPTION_KEY) {
    console.log("[local-db] Skipped: DATABASE_URL or CREDENTIALS_ENCRYPTION_KEY missing.");
    return false;
  }

  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.DATABASE_URL = env.DATABASE_URL;
  process.env.CREDENTIALS_ENCRYPTION_KEY = env.CREDENTIALS_ENCRYPTION_KEY;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await prisma.apiCredential.upsert({
      where: { key: "SHOPIFY_ADMIN_ACCESS_TOKEN" },
      create: {
        key: "SHOPIFY_ADMIN_ACCESS_TOKEN",
        value: encryptCredential(token, env.CREDENTIALS_ENCRYPTION_KEY),
        updatedBy: "system",
      },
      update: {
        value: encryptCredential(token, env.CREDENTIALS_ENCRYPTION_KEY),
        updatedBy: "system",
      },
    });
    console.log(`[local-db] ApiCredential synced. token_length=${token.length}`);
    return true;
  } finally {
    await prisma.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
}

async function checkLocalDb({ envPath, store, apiVersion, envToken }) {
  const env = loadEnv(envPath);
  if (!env.DATABASE_URL || !env.CREDENTIALS_ENCRYPTION_KEY) {
    console.log("[local-db] Skipped: DATABASE_URL or CREDENTIALS_ENCRYPTION_KEY missing.");
    return;
  }

  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.DATABASE_URL = env.DATABASE_URL;
  process.env.CREDENTIALS_ENCRYPTION_KEY = env.CREDENTIALS_ENCRYPTION_KEY;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const credential = await prisma.apiCredential.findUnique({
      where: { key: "SHOPIFY_ADMIN_ACCESS_TOKEN" },
      select: { value: true },
    });
    if (!credential) throw new Error("[local-db] ApiCredential.SHOPIFY_ADMIN_ACCESS_TOKEN is missing");

    const token = decryptCredential(credential.value, env.CREDENTIALS_ENCRYPTION_KEY);
    await validateToken({ store, apiVersion, token, label: "local-db" });
    console.log(`[local-db] token_length=${token.length}`);
    assertMatch({ left: token, right: envToken, label: "[local-db] matches_app_env" });
  } finally {
    await prisma.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
}

function writeRemoteEnvToken({ server, serverEnv, token }) {
  const tmp = mkdtempSync(join(tmpdir(), "shopify-token-refresh-"));
  const localScript = join(tmp, "update-server-env.py");
  const remoteScript = `/tmp/update-shopify-env-token-${process.pid}.py`;

  writeFileSync(
    localScript,
    `import sys\nfrom pathlib import Path\npath = Path(sys.argv[1])\ntoken = sys.stdin.read().strip()\nif not token:\n    raise SystemExit('missing token stdin')\ntext = path.read_text()\nlines = text.splitlines()\nout = []\nfound = False\nfor line in lines:\n    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):\n        out.append('SHOPIFY_ADMIN_ACCESS_TOKEN=' + token)\n        found = True\n    else:\n        out.append(line)\nif not found:\n    out.append('SHOPIFY_ADMIN_ACCESS_TOKEN=' + token)\npath.write_text('\\n'.join(out) + '\\n')\nprint('server_env_updated')\n`,
    "utf8"
  );

  try {
    run("scp", [localScript, `${server}:${remoteScript}`], { label: "scp env updater" });
    const output = run(
      "ssh",
      [server, `python3 ${shellQuote(remoteScript)} ${shellQuote(serverEnv)}; status=$?; rm -f ${shellQuote(remoteScript)}; exit $status`],
      { input: token, label: "server env update" }
    );
    console.log(`[server-env] ${output}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function runRemoteNode({ server, serverAppDir, name, source }) {
  const tmp = mkdtempSync(join(tmpdir(), "shopify-token-refresh-"));
  const localScript = join(tmp, `${name}.mjs`);
  const remoteScript = `${serverAppDir}/.${name}-${process.pid}.mjs`;
  writeFileSync(localScript, source, "utf8");

  try {
    run("scp", [localScript, `${server}:${remoteScript}`], { label: `scp ${name}` });
    const output = run(
      "ssh",
      [server, `cd ${shellQuote(serverAppDir)} && node ${shellQuote(remoteScript)}; status=$?; rm -f ${shellQuote(remoteScript)}; exit $status`],
      { label: `server ${name}` }
    );
    return output;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function remoteEnvParserSource(serverEnv) {
  return `
import { readFileSync } from "fs";

function loadEnv(file) {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\\r?\\n/)
      .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if ((value.startsWith("\\"") && value.endsWith("\\"")) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
  );
}

const env = loadEnv(${JSON.stringify(serverEnv)});
for (const [key, value] of Object.entries(env)) process.env[key] = value;
`;
}

function validateRemoteToken({ server, serverAppDir, serverEnv }) {
  const source = `${remoteEnvParserSource(serverEnv)}
const store = String(process.env.SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\\/\\//, "").replace(/\\/$/, "");
const version = process.env.SHOPIFY_API_VERSION || "2026-04";
const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
if (!token) throw new Error("server_env_token_missing");
const response = await fetch(\`https://\${store}/admin/api/\${version}/shop.json\`, {
  headers: { "X-Shopify-Access-Token": token },
});
if (!response.ok) {
  console.error(\`server_shopify_http=\${response.status}\`);
  process.exit(1);
}
console.log(\`server_shopify_http=\${response.status}\`);
console.log(\`server_token_length=\${token.length}\`);
`;
  const output = runRemoteNode({ server, serverAppDir, name: "validate-shopify-token", source });
  console.log(output);
}

function checkRemoteDb({ server, serverAppDir, serverEnv }) {
  const source = `${remoteEnvParserSource(serverEnv)}
import { PrismaClient } from "@prisma/client";
import { createDecipheriv, createHash } from "crypto";

function decrypt(ciphertext) {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY missing or too short");
  const key = createHash("sha256").update(raw).digest();
  const payload = Buffer.from(ciphertext, "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

const envToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
if (!envToken) throw new Error("server_env_token_missing");

const prisma = new PrismaClient();
try {
  const credential = await prisma.apiCredential.findUnique({
    where: { key: "SHOPIFY_ADMIN_ACCESS_TOKEN" },
    select: { value: true },
  });
  if (!credential) throw new Error("server_db_credential_missing");

  const token = decrypt(credential.value);
  const store = String(process.env.SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\\/\\//, "").replace(/\\/$/, "");
  const version = process.env.SHOPIFY_API_VERSION || "2026-04";
  const response = await fetch(\`https://\${store}/admin/api/\${version}/shop.json\`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!response.ok) {
    console.error(\`server_db_shopify_http=\${response.status}\`);
    process.exit(1);
  }

  console.log(\`server_db_shopify_http=\${response.status}\`);
  console.log(\`server_db_token_length=\${token.length}\`);
  console.log(\`server_db_matches_env=\${token === envToken ? "yes" : "no"}\`);
  if (token !== envToken) process.exit(1);
} finally {
  await prisma.$disconnect();
}
`;
  const output = runRemoteNode({ server, serverAppDir, name: "check-shopify-token-db", source });
  console.log(output);
}

function syncRemoteDb({ server, serverAppDir, serverEnv }) {
  const source = `${remoteEnvParserSource(serverEnv)}
import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHash, randomBytes } from "crypto";

function encrypt(plaintext) {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY missing or too short");
  const key = createHash("sha256").update(raw).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
if (!token) throw new Error("SHOPIFY_ADMIN_ACCESS_TOKEN missing from server env");
const prisma = new PrismaClient();
try {
  await prisma.apiCredential.upsert({
    where: { key: "SHOPIFY_ADMIN_ACCESS_TOKEN" },
    create: { key: "SHOPIFY_ADMIN_ACCESS_TOKEN", value: encrypt(token), updatedBy: "system" },
    update: { value: encrypt(token), updatedBy: "system" },
  });
  console.log("server_db_credential_updated");
  console.log(\`server_db_token_length=\${token.length}\`);
} finally {
  await prisma.$disconnect();
}
`;
  const output = runRemoteNode({ server, serverAppDir, name: "sync-shopify-token-db", source });
  console.log(output);
}

function restartRemote({ server }) {
  const output = run(
    "ssh",
    [
      server,
      `pm2 restart autopilot --update-env >/tmp/autopilot-pm2-restart.log && rm -f /tmp/autopilot-pm2-restart.log && pm2 jlist | node -e ${shellQuote("let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='autopilot'); console.log('pm2_status=' + (p && p.pm2_env.status));})")}`,
    ],
    { label: "server pm2 restart" }
  );
  console.log(output);
}

async function checkHealth(url) {
  const response = await fetch(url);
  console.log(`[health] ${url} HTTP ${response.status}.`);
  if (!response.ok) throw new Error(`Health check failed: HTTP ${response.status}`);
}

async function checkCurrentTokens({ options, store, apiVersion, appEnv, themeEnv }) {
  const appToken = appEnv.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
  const themeToken = themeEnv.SHOPIFY_ADMIN_ACCESS_TOKEN || "";

  await validateToken({ store, apiVersion, token: appToken, label: "local-app-env" });
  console.log(`[local-app-env] token_length=${appToken.length}`);

  if (existsSync(options.themeEnv)) {
    await validateToken({ store, apiVersion, token: themeToken, label: "local-theme-env" });
    console.log(`[local-theme-env] token_length=${themeToken.length}`);
    assertMatch({ left: appToken, right: themeToken, label: "[local-env] app_theme_tokens_match" });
  }

  if (options.syncLocalDb) {
    await checkLocalDb({ envPath: options.appEnv, store, apiVersion, envToken: appToken });
  }

  if (options.localOnly) return;

  validateRemoteToken({
    server: options.server,
    serverAppDir: options.serverAppDir,
    serverEnv: options.serverEnv,
  });

  if (options.syncServerDb) {
    checkRemoteDb({
      server: options.server,
      serverAppDir: options.serverAppDir,
      serverEnv: options.serverEnv,
    });
  }

  await checkHealth(options.healthUrl);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const themeEnv = loadEnv(options.themeEnv);
  const appEnv = loadEnv(options.appEnv);

  const store = normalizeStoreDomain(themeEnv.SHOPIFY_STORE_DOMAIN || appEnv.SHOPIFY_STORE_DOMAIN);
  const apiKey = themeEnv.SHOPIFY_API_KEY || appEnv.SHOPIFY_API_KEY;
  const apiSecret = themeEnv.SHOPIFY_API_SECRET || appEnv.SHOPIFY_API_SECRET;
  const apiVersion = themeEnv.SHOPIFY_API_VERSION || appEnv.SHOPIFY_API_VERSION || "2026-04";

  requireValue(store, "SHOPIFY_STORE_DOMAIN");

  if (options.checkOnly) {
    await checkCurrentTokens({ options, store, apiVersion, appEnv, themeEnv });
    return;
  }

  requireValue(apiKey, "SHOPIFY_API_KEY");
  requireValue(apiSecret, "SHOPIFY_API_SECRET");

  const token = await refreshToken({ store, apiKey, apiSecret });
  console.log(`[refresh] Fresh Shopify Admin API access token generated. token_length=${token.length}`);
  await validateToken({ store, apiVersion, token, label: "local" });

  for (const envPath of [options.themeEnv, options.appEnv]) {
    if (!existsSync(envPath)) {
      console.log(`[local-env] Skipped missing file: ${envPath}`);
      continue;
    }
    updateEnvFile(envPath, "SHOPIFY_ADMIN_ACCESS_TOKEN", token);
    console.log(`[local-env] Updated ${envPath}`);
  }

  assertEnvFileToken({ envPath: options.themeEnv, token, label: "local-theme-env" });
  assertEnvFileToken({ envPath: options.appEnv, token, label: "local-app-env" });

  const localDbSynced = options.syncLocalDb ? await syncLocalDb({ envPath: options.appEnv, token }) : false;
  if (localDbSynced) await checkLocalDb({ envPath: options.appEnv, store, apiVersion, envToken: token });

  if (options.localOnly) return;

  writeRemoteEnvToken({ server: options.server, serverEnv: options.serverEnv, token });
  validateRemoteToken({
    server: options.server,
    serverAppDir: options.serverAppDir,
    serverEnv: options.serverEnv,
  });

  if (options.syncServerDb) {
    syncRemoteDb({
      server: options.server,
      serverAppDir: options.serverAppDir,
      serverEnv: options.serverEnv,
    });
    checkRemoteDb({
      server: options.server,
      serverAppDir: options.serverAppDir,
      serverEnv: options.serverEnv,
    });
  }

  if (options.restart) {
    restartRemote({ server: options.server });
    await checkHealth(options.healthUrl);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

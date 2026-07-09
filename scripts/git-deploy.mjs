/**
 * Deploy app updates through git instead of rsync.
 *
 * Run:
 *   node scripts/git-deploy.mjs
 *   node scripts/git-deploy.mjs --branch main
 *
 * This script:
 * - pushes the selected local branch to origin
 * - initializes /opt/autopilot as a git worktree if needed
 * - fetches the same branch on the VPS using GITHUB_TOKEN from local env
 * - preserves server-owned runtime files such as .env, node_modules, .next
 * - builds into .next.build, atomically swaps .next, and restarts PM2
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const ipFile = resolve(__dir, ".linode-ip");
const IP = process.env.LINODE_IP
  || (existsSync(ipFile) ? readFileSync(ipFile, "utf8").trim() : null);

if (!IP) {
  console.error("No Linode IP found. Set LINODE_IP env var or run linode-provision.mjs first.");
  process.exit(1);
}

function expandHome(value) {
  return value.startsWith("~/") ? `${process.env.HOME}/${value.slice(2)}` : value;
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
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function maskedArgs(args) {
  return args.map((arg) => {
    if (typeof arg !== "string") return arg;
    if (/authorization:/i.test(arg) || /github_pat_/i.test(arg) || /ghp_/i.test(arg)) {
      return "[REDACTED]";
    }
    return arg;
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    stdio: options.stdio ?? "inherit",
    encoding: "utf8",
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${maskedArgs(args).join(" ")} failed with status ${result.status}`);
  }
  return result.stdout?.trim() ?? "";
}

function readLocalEnv() {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) return {};

  const values = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const branch = argValue("--branch") || run("git", ["branch", "--show-current"], { stdio: "pipe" });
if (!branch) {
  console.error("Could not determine current git branch. Pass --branch <name>.");
  process.exit(1);
}

const originUrl = run("git", ["config", "--get", "remote.origin.url"], { stdio: "pipe" });
if (!originUrl) {
  console.error("No git remote named origin is configured.");
  process.exit(1);
}

const localEnv = readLocalEnv();
const githubToken = process.env.GITHUB_TOKEN || localEnv.GITHUB_TOKEN;
if (!githubToken) {
  console.error("GITHUB_TOKEN is required in the environment or local .env.");
  process.exit(1);
}
const githubAuthHeader = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${githubToken}`).toString("base64")}`;

const sshKey = resolveSshKey();
const sshOpts = ["-o", "StrictHostKeyChecking=no", ...(sshKey ? ["-i", sshKey] : [])];

console.log(sshKey ? `Using SSH key ${sshKey}` : "Using default SSH agent/config keys");
console.log(`Deploying branch ${branch} to ${IP} through git...\n`);

console.log("==> Pushing branch to origin...");
run("git", [
  "-c",
  `http.extraHeader=${githubAuthHeader}`,
  "push",
  "-u",
  "origin",
  `${branch}:${branch}`,
]);

console.log("\n==> Pulling and building on server...");
const remoteScript = `
set -euo pipefail

APP=/opt/autopilot
BRANCH=${shellQuote(branch)}
REPO_URL=${shellQuote(originUrl)}
GITHUB_AUTH_HEADER=${shellQuote(githubAuthHeader)}

cd "$APP" || exit 1

if [ ! -d .git ]; then
  git init
  git remote add origin "$REPO_URL"
fi

git remote set-url origin "$REPO_URL"
git config --local advice.detachedHead false

mkdir -p .git/info
grep -qxF '.env' .git/info/exclude 2>/dev/null || cat >> .git/info/exclude <<'EOF'
.env
.env.local
.env.production
node_modules/
.next/
.next.build/
.next.old/
.npm-cache/
tmp/
.seo-cache/
tsconfig.tsbuildinfo
tsconfig.test.tsbuildinfo
EOF

git -c "http.extraHeader=$GITHUB_AUTH_HEADER" fetch origin "$BRANCH"
git reset --hard FETCH_HEAD
git checkout -B "$BRANCH" FETCH_HEAD
git clean -fd -e .env -e node_modules/ -e .next/ -e .next.build/ -e .next.old/ -e .npm-cache/ -e tmp/ -e .seo-cache/

rm -f .env.local .env.production

if [ ! -f /swapfile-autopilot ]; then
  fallocate -l 2G /swapfile-autopilot || dd if=/dev/zero of=/swapfile-autopilot bs=1M count=2048
  chmod 600 /swapfile-autopilot
  mkswap /swapfile-autopilot
  grep -q '^/swapfile-autopilot ' /etc/fstab || echo '/swapfile-autopilot none swap sw 0 0' >> /etc/fstab
fi
swapon /swapfile-autopilot 2>/dev/null || true

mkdir -p /opt/autopilot/.npm-cache
bash --norc --noprofile -c 'set -o pipefail; npm install --prefer-offline --no-audit --no-fund --cache /opt/autopilot/.npm-cache 2>&1 | tail -20' || exit 1

set -a
set +e
source .env
set -e
set +a

npm run db:migrate || exit 1

rm -rf .next.build
mkdir -p .next.build
if [ -d .next/cache ]; then
  mkdir -p .next.build/cache
  cp -a .next/cache/. .next.build/cache/
fi

bash --norc --noprofile -c 'set -o pipefail; NEXT_OUTPUT_DIR=.next.build npm run build:remote 2>&1 | tail -80' || (rm -rf /opt/autopilot/.next.build; exit 1)

rm -rf .next.old
(mv .next .next.old 2>/dev/null || true)
mv .next.build .next

pm2 restart autopilot --update-env || pm2 start /opt/autopilot/ecosystem.config.js
rm -rf /opt/autopilot/.next.old /opt/autopilot/.next.build
`;

run("ssh", [
  ...sshOpts,
  `root@${IP}`,
  remoteScript,
], { cwd: ROOT });

console.log("\n==> Verifying health...");
run("curl", ["-fsS", "https://autopilot.agrikoph.com/api/health"], { cwd: ROOT });

console.log("\n✓ Git deploy complete\n");

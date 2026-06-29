/**
 * Run the dashboard baseline on the production server over SSH.
 *
 * This avoids exposing Postgres publicly. The script reads SSH metadata from a
 * local env file, pipes scripts/dashboard-baseline.mjs to the remote server,
 * and lets the remote app use its own /opt/autopilot/.env DATABASE_URL.
 *
 * Usage:
 *   npm run dashboard:baseline:remote -- --days 30 --json
 *   npm run dashboard:baseline:remote -- --ssh-env .env --remote-dir /opt/autopilot --remote-env .env --days 30
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import process from "process";
import dotenv from "dotenv";

function consumeOption(args, name, fallback) {
  const idx = args.indexOf(name);
  if (idx === -1) return { value: fallback, args };
  const value = args[idx + 1] ?? fallback;
  return {
    value,
    args: [...args.slice(0, idx), ...args.slice(idx + 2)],
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

let passthroughArgs = process.argv.slice(2);
let parsed = consumeOption(passthroughArgs, "--ssh-env", ".env");
const sshEnvFile = parsed.value;
passthroughArgs = parsed.args;

parsed = consumeOption(passthroughArgs, "--remote-dir", "/opt/autopilot");
const remoteDir = parsed.value;
passthroughArgs = parsed.args;

parsed = consumeOption(passthroughArgs, "--remote-env", ".env");
const remoteEnv = parsed.value;
passthroughArgs = parsed.args;

dotenv.config({ path: sshEnvFile, override: false });

const remoteUser = process.env.REMOTE_SERVER_USER || "root";
const remoteHost = process.env.REMOTE_SERVER_IP || process.env.LINODE_IP;
const remotePass = process.env.REMOTE_SERVER_PASS;
const sshKey = process.env.SSH_KEY;

if (!remoteHost) {
  console.error(`REMOTE_SERVER_IP or LINODE_IP is required in ${sshEnvFile}.`);
  process.exit(1);
}

const baselineScriptPath = path.resolve("scripts/dashboard-baseline.mjs");
const baselineScript = fs.readFileSync(baselineScriptPath, "utf8");

const baselineArgs = passthroughArgs.includes("--env")
  ? passthroughArgs
  : ["--env", remoteEnv, ...passthroughArgs];

const remoteCommand = [
  "cd",
  shellQuote(remoteDir),
  "&&",
  "node",
  "--input-type=module",
  "-",
  ...baselineArgs.map(shellQuote),
].join(" ");

const sshBaseArgs = [
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "ConnectTimeout=10",
];

let command;
let args;
const env = { ...process.env };

if (sshKey && fs.existsSync(sshKey)) {
  command = "ssh";
  args = [...sshBaseArgs, "-i", sshKey, `${remoteUser}@${remoteHost}`, remoteCommand];
} else if (remotePass) {
  command = "sshpass";
  args = ["-e", "ssh", ...sshBaseArgs, `${remoteUser}@${remoteHost}`, remoteCommand];
  env.SSHPASS = remotePass;
} else {
  console.error(`Either SSH_KEY must point to an existing key or REMOTE_SERVER_PASS must be set in ${sshEnvFile}.`);
  process.exit(1);
}

const result = spawnSync(command, args, {
  input: baselineScript,
  encoding: "utf8",
  env,
  stdio: ["pipe", "inherit", "inherit"],
});

if (result.error) {
  console.error(`Remote baseline failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

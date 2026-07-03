#!/usr/bin/env node
import "dotenv/config";
import { createServer } from "http";
import { existsSync, readFileSync } from "fs";

function normalizeWindowsPath(value) {
  const match = String(value ?? "").match(/^([A-Za-z]):\\(.*)$/);
  if (!match) return value;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

function resolveExistingFile(value) {
  if (!value) return null;
  const normalized = normalizeWindowsPath(String(value).replace(/^['"]|['"]$/g, ""));
  const candidates = [normalized, `${normalized}.json`];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function readOAuthClient() {
  const file = resolveExistingFile(process.env.GOOGLE_ADS_OAUTH_CLIENT_JSON_PATH)
    ?? resolveExistingFile(process.env.GOOGLE_ADS_CLIENT_SECRET_JSON_PATH)
    ?? "/mnt/c/Users/Sean/Documents/Agriko/cinema/shopify-theme/scripts/client_secret_688813638250-obtfv17tehutjuqm3cesouctcpg1rmt8.apps.googleusercontent.com.json";
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return parsed.web ?? parsed.installed ?? parsed;
}

const client = readOAuthClient();
const redirectUri = "http://localhost:8787/oauth2callback";
const scope = "https://www.googleapis.com/auth/adwords";

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", client.client_id);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", scope);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl.toString());
console.log("\nWaiting on http://localhost:8787/oauth2callback ...\n");

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "", redirectUri);
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400);
      res.end("Missing code");
      return;
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: client.client_id,
        client_secret: client.client_secret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const payload = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(JSON.stringify(payload));

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Google Ads OAuth complete. You can return to the terminal.");

    console.log("Add this to /opt/autopilot/.env and local .env:");
    console.log(`GOOGLE_ADS_REFRESH_TOKEN=${payload.refresh_token}`);
    console.log("\nThen restart the app with: pm2 restart autopilot --update-env");
    server.close();
  } catch (err) {
    res.writeHead(500);
    res.end("OAuth failed. Check terminal output.");
    console.error(err);
    server.close(() => process.exit(1));
  }
});

server.listen(8787);

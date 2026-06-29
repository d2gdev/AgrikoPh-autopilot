#!/usr/bin/env node
// One-time script: grants service account access to GA4 property
// Run: node scripts/grant-ga4-access.mjs

import { createServer } from "http";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PROPERTY_ID = "512447424";
const SERVICE_ACCOUNT_EMAIL = "analytics-ga-4@gen-lang-client-0853027342.iam.gserviceaccount.com";
const REDIRECT_URI = "http://localhost:3333/callback";
const SCOPE = "https://www.googleapis.com/auth/analytics.manage.users";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET env vars.");
  console.error("Set them from: https://console.cloud.google.com/apis/credentials");
  process.exit(1);
}

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code&scope=${encodeURIComponent(SCOPE)}&access_type=offline&prompt=consent`;

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for Google to redirect back...\n");

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:3333");
  const code = url.searchParams.get("code");
  if (!code) { res.end("No code"); return; }

  res.end("<html><body><h2>Authorized! You can close this tab.</h2></body></html>");
  server.close();

  // Exchange code for token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  const accessToken = tokens.access_token;
  if (!accessToken) { console.error("Token exchange failed:", tokens); process.exit(1); }

  // Add service account to GA4 property
  const addRes = await fetch(
    `https://analyticsadmin.googleapis.com/v1alpha/properties/${PROPERTY_ID}/accessBindings`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user: SERVICE_ACCOUNT_EMAIL,
        roles: ["predefinedRoles/viewer"],
      }),
    }
  );

  const result = await addRes.json();
  if (addRes.ok) {
    console.log("✓ Service account granted Viewer access to GA4 property", PROPERTY_ID);
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error("✗ Failed:", JSON.stringify(result, null, 2));
  }
  process.exit(0);
});

server.listen(3333);

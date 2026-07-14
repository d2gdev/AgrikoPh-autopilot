#!/usr/bin/env node
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { GoogleAuth } from "google-auth-library";

const API_BASE = "https://merchantapi.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/content";
const isQuick = process.argv.includes("--quick");

const CHECKS = [
  { name: "account", required: true, path: "/accounts/v1/accounts/{merchantId}" },
  { name: "developerRegistration", required: true, tolerateServerError: true, path: "/accounts/v1/accounts/{merchantId}/developerRegistration" },
  { name: "users", required: true, path: "/accounts/v1/accounts/{merchantId}/users?pageSize=100", validateUser: true },
  { name: "dataSources", required: false, path: "/datasources/v1/accounts/{merchantId}/dataSources" },
  { name: "products", required: false, path: "/products/v1/accounts/{merchantId}/products" },
];

function normalizePath(value) {
  return String(value ?? "").trim().replace(/^["']|["']$/g, "");
}

function resolveCredentialsPath(value) {
  if (!value) return null;
  const candidate = normalizePath(value);
  if (!candidate) return null;
  return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
}

function isMissingEnv() {
  const merchantId = process.env.GOOGLE_MERCHANT_ID;
  const credentialsPath = resolveCredentialsPath(process.env.GOOGLE_MERCHANT_ACCOUNT_JSON);

  if (!merchantId) {
    throw new Error("Missing GOOGLE_MERCHANT_ID in environment.");
  }
  if (!credentialsPath) {
    throw new Error("Missing GOOGLE_MERCHANT_ACCOUNT_JSON in environment.");
  }
  if (!existsSync(credentialsPath)) {
    throw new Error(`Service account file not found: ${credentialsPath}`);
  }
  return { merchantId, credentialsPath };
}

function readClientEmail(credentialsPath) {
  const serviceAccount = JSON.parse(readFileSync(credentialsPath, "utf8"));
  if (!serviceAccount?.client_email) {
    throw new Error(`Invalid service account JSON: missing client_email (${credentialsPath})`);
  }
  return serviceAccount.client_email;
}

async function main() {
  let merchantId;
  let credentialsPath;
  try {
    ({ merchantId, credentialsPath } = isMissingEnv());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const clientEmail = readClientEmail(credentialsPath);
  const auth = new GoogleAuth({ keyFile: credentialsPath, scopes: [SCOPE] });

  let token;
  try {
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    token = typeof accessToken === "string" ? accessToken : accessToken?.token;
  } catch (error) {
    console.error("Failed to load Google credentials/token:");
    console.error(error.message || error);
    process.exitCode = 1;
    return;
  }

  if (!token) {
    console.error("Failed to obtain access token from service account.");
    process.exitCode = 1;
    return;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  const failures = [];
  let serviceAccountFound = false;
  let serviceAccountVerified = false;
  let apiDeveloperRole = false;

  for (const check of CHECKS) {
    if (isQuick && !check.required) continue;

    const endpoint = check.path.replaceAll("{merchantId}", merchantId);
    const url = `${API_BASE}${endpoint}`;
    const response = await fetch(url, { headers });
    const bodyText = await response.text();
    const payloadText = bodyText && bodyText.length > 500 ? `${bodyText.slice(0, 500)}...` : bodyText;

    if (!response.ok) {
      const detail = `${response.status} ${response.statusText}`;
      const toleratedServerError = check.tolerateServerError && response.status >= 500;
      const report = toleratedServerError ? console.warn : console.error;
      const level = toleratedServerError ? "WARN" : "FAIL";
      report(`[${level}] ${check.name}: GET ${endpoint} -> ${detail}`);
      if (payloadText) console.error(payloadText);
      if (check.required && !toleratedServerError) {
        failures.push({ name: check.name, status: response.status });
      }
      continue;
    }

    console.log(`[OK] ${check.name}: GET ${endpoint} (${response.status})`);

    if (check.validateUser) {
      try {
        const payload = JSON.parse(bodyText || "{}");
        const users = payload?.users ?? [];
        const entry = users.find(
          (user) => decodeURIComponent(user.name.split("/").at(-1) ?? "") === clientEmail
        );
        serviceAccountFound = Boolean(entry);
        serviceAccountVerified = entry?.state === "VERIFIED";
        apiDeveloperRole = Array.isArray(entry?.accessRights) && entry.accessRights.includes("API_DEVELOPER");
      } catch {
        console.warn(`[WARN] users: response could not be parsed`);
      }
    }
  }

  if (!serviceAccountFound) {
    console.error(`[FAIL] users: service account ${clientEmail} not listed`);
    failures.push({ name: "users", status: "missing_service_account" });
  } else {
    console.log(`[OK] users: service account found for ${clientEmail}`);
    if (serviceAccountVerified) {
      console.log(`[OK] users: service account is VERIFIED`);
    } else {
      console.warn(`[WARN] users: service account is not VERIFIED`);
    }
    if (apiDeveloperRole) {
      console.log(`[OK] users: API_DEVELOPER role present`);
    } else {
      console.warn(`[WARN] users: API_DEVELOPER role not present`);
    }
  }

  if (failures.length > 0) {
    console.error(`\nGoogle Merchant API healthcheck failed (${isQuick ? "quick" : "full"}): ${failures.length} issue(s).`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nGoogle Merchant API healthcheck passed (${isQuick ? "quick" : "full"}).`);
}

await main();

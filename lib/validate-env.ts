// Environment variable validation.
// Credential encryption is implemented in lib/crypto.ts — CREDENTIALS_ENCRYPTION_KEY must be >= 32 chars.
const REQUIRED_ENV_VARS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_ADMIN_ACCESS_TOKEN",
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_APP_URL",
  "DATABASE_URL",
  "CRON_SECRET",
  "CREDENTIALS_ENCRYPTION_KEY",
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join("\n")}`
    );
  }

  if (!process.env.DEEPSEEK_API_KEY && !process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "Missing AI provider key: set DEEPSEEK_API_KEY for the primary backend or OPENROUTER_API_KEY as fallback."
    );
  }

  // Minimum-length assertions for secrets that must meet a security threshold.
  const autopilotKey = process.env.AUTOPILOT_API_KEY ?? "";
  if (autopilotKey && autopilotKey.length < 32) {
    throw new Error(
      `AUTOPILOT_API_KEY must be at least 32 characters long (got ${autopilotKey.length}). ` +
        "Generate a strong key with: openssl rand -hex 32"
    );
  }
}

require("dotenv").config();
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_PROD) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
}
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");

// Fail fast if required env vars are missing
const REQUIRED_ENV = [
  "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_ADMIN_ACCESS_TOKEN",
  "SHOPIFY_STORE_DOMAIN", "SHOPIFY_APP_URL", "OPENROUTER_API_KEY",
  "DATABASE_URL", "CRON_SECRET", "CREDENTIALS_ENCRYPTION_KEY",
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`[server] Missing required env vars:\n${missing.map((k) => `  - ${k}`).join("\n")}`);
  process.exit(1);
}

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare()
  .then(() => {
    const server = createServer((req, res) => {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl).catch((err) => {
        console.error("[server] Request handler error:", err);
        res.statusCode = 500;
        res.end("Internal Server Error");
      });
    });

    server.listen(process.env.PORT || 3000, (err) => {
      if (err) throw err;
      console.log(`[server] Ready on http://localhost:${process.env.PORT || 3000}`);
    });

    // Graceful shutdown — PM2 sends SIGTERM before killing the process.
    // Without this handler, in-flight requests are hard-killed and JobRun rows
    // can get stuck with status 'running'.
    process.on("SIGTERM", () => {
      console.log("[server] SIGTERM received, shutting down gracefully");
      server.close(() => {
        const prisma = globalThis.prisma;
        if (prisma?.$disconnect) {
          prisma.$disconnect().then(() => process.exit(0)).catch(() => process.exit(1));
          return;
        }
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000); // force kill after 10s if still hung
    });
  })
  .catch((err) => {
    console.error("[server] Failed to start:", err);
    process.exit(1);
  });

import { PrismaClient } from "@prisma/client";
import { assertDatabaseUrlReady } from "./db-url";

if (!process.env.DATABASE_URL && process.env.DATABASE_URL_PROD) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
}

const databaseUrlDiagnostics = assertDatabaseUrlReady();

for (const warning of databaseUrlDiagnostics.warnings) {
  console.warn(`[db] ${warning}`);
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// For production, DATABASE_URL should include ?connection_limit=10 to cap the pool size.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: "stdout", level: "warn" },
      { emit: "stdout", level: "error" },
    ],
  });

// Always cache in global — works for both serverless (Vercel) and persistent servers (Railway/Render)
globalForPrisma.prisma = prisma;

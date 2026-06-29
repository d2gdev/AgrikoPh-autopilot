import { describe, expect, it } from "vitest";
import { assertDatabaseUrlReady, getDatabaseUrlDiagnostics, resolveDatabaseUrl } from "@/lib/db-url";

describe("database URL diagnostics", () => {
  it("uses DATABASE_URL before DATABASE_URL_PROD", () => {
    const resolved = resolveDatabaseUrl({
      DATABASE_URL: "postgresql://user:pass@app-db:5432/app?connection_limit=10",
      DATABASE_URL_PROD: "postgresql://user:pass@prod-db:5432/app?connection_limit=10",
    });

    expect(resolved).toEqual({
      url: "postgresql://user:pass@app-db:5432/app?connection_limit=10",
      source: "DATABASE_URL",
    });
  });

  it("falls back to DATABASE_URL_PROD", () => {
    const resolved = resolveDatabaseUrl({
      DATABASE_URL_PROD: "postgresql://user:pass@prod-db:5432/app?connection_limit=10",
    });

    expect(resolved.source).toBe("DATABASE_URL_PROD");
    expect(resolved.url).toContain("prod-db");
  });

  it("reports missing pool timeout as a warning", () => {
    const diagnostics = getDatabaseUrlDiagnostics({
      DATABASE_URL: "postgresql://user:pass@app-db:5432/app?connection_limit=10",
    });

    expect(diagnostics.valid).toBe(true);
    expect(diagnostics.hasConnectionLimit).toBe(true);
    expect(diagnostics.connectionLimit).toBe(10);
    expect(diagnostics.hasPoolTimeout).toBe(false);
    expect(diagnostics.warnings).toContain(
      "DATABASE_URL should include pool_timeout so pool exhaustion fails quickly instead of hanging."
    );
  });

  it("requires connection_limit in production", () => {
    const diagnostics = getDatabaseUrlDiagnostics({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@app-db:5432/app",
    });

    expect(diagnostics.valid).toBe(false);
    expect(diagnostics.errors).toContain("DATABASE_URL should include connection_limit to cap Prisma pool size.");
  });

  it("throws in strict mode when the URL is unsafe", () => {
    expect(() =>
      assertDatabaseUrlReady({
        DATABASE_URL_STRICT: "true",
        DATABASE_URL: "postgresql://user:pass@app-db:5432/app",
      })
    ).toThrow(/Database URL validation failed/);
  });
});

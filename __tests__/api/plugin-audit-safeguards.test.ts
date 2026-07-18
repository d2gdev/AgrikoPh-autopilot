import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireCronAuth: vi.fn(),
}));
const rate = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
}));
const db = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireCronAuth: auth.requireCronAuth }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: rate.checkRateLimit }));
vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: db.query },
}));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name))
      : entry.name === "route.ts"
        ? [join(dir, entry.name)]
        : [],
  );
}

const embeddedRoute = (file: string) =>
  !/^app\/api\/(auth|cron|health|ping|webhooks)\//.test(file.replaceAll("\\", "/"));

describe("plugin audit security contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireCronAuth.mockReturnValue(null);
    rate.checkRateLimit.mockReturnValue(true);
    db.query.mockResolvedValue([{ "?column?": 1 }]);
  });

  it("starts every embedded API handler with requireAppAuth", () => {
    const offenders: string[] = [];
    for (const file of walk("app/api").filter(embeddedRoute)) {
      const source = readFileSync(file, "utf8");
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      for (const statement of parsed.statements) {
        if (!ts.isFunctionDeclaration(statement)
          || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
          || !["GET", "POST", "PATCH", "PUT", "DELETE"].includes(statement.name?.text ?? "")
          || !statement.body) continue;
        const first = statement.body.statements[0]?.getText(parsed).replace(/\s+/g, " ");
        if (!first?.includes("await requireAppAuth(req)")) {
          offenders.push(`${file}:${statement.name?.text}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("bounds bulk image generation and reports exact outcomes", () => {
    const source = readFileSync("app/(embedded)/(store-pilot)/images/page.tsx", "utf8");
    expect(source).toContain("missing.slice(0, 30)");
    expect(source).toContain("succeeded");
    expect(source).toContain("failed");
    expect(source).toContain("remaining");
    expect(source).not.toContain('setToast({ message: "Suggestions generated — review and click Apply to write them to Shopify" })');
  });

  it("requires cron auth and rate limiting before the ping query", async () => {
    const { GET } = await import("@/app/api/ping/route");
    const req = new Request("http://test.local/api/ping");

    const response = await GET(req);

    expect(response.status).toBe(200);
    expect(auth.requireCronAuth).toHaveBeenCalledWith(req);
    expect(rate.checkRateLimit).toHaveBeenCalledWith("cron:ping", 20, 60_000);
    expect(auth.requireCronAuth.mock.invocationCallOrder[0]).toBeLessThan(
      rate.checkRateLimit.mock.invocationCallOrder[0]!,
    );
    expect(rate.checkRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      db.query.mock.invocationCallOrder[0]!,
    );
  });

  it("rejects unauthorized and rate-limited ping requests before querying", async () => {
    const { GET } = await import("@/app/api/ping/route");
    auth.requireCronAuth.mockReturnValueOnce(new Response(null, { status: 401 }));
    expect((await GET(new Request("http://test.local/api/ping"))).status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();

    auth.requireCronAuth.mockReturnValueOnce(null);
    rate.checkRateLimit.mockReturnValueOnce(false);
    expect((await GET(new Request("http://test.local/api/ping"))).status).toBe(429);
    expect(db.query).not.toHaveBeenCalled();
  });
});

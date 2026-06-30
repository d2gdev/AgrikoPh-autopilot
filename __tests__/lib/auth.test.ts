import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock is hoisted to top of file, so factory must not reference outer variables.
vi.mock("@/lib/shopify", () => ({
  verifySessionToken: vi.fn().mockResolvedValue("test.myshopify.com"),
  decodeSessionUser: vi.fn().mockResolvedValue("user-123"),
}));

import {
  authorizePermission,
  getSessionShop,
  getSessionUser,
  PERMISSIONS,
  requireAppAuth,
  requireCronAuth,
  requirePrivateApiKeyAuth,
} from "@/lib/auth";
import { verifySessionToken, decodeSessionUser } from "@/lib/shopify";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/test", { headers });
}

describe("requireCronAuth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 when Authorization header is missing", () => {
    vi.stubEnv("CRON_SECRET", "my-secret");
    const req = makeRequest({});
    const res = requireCronAuth(req);
    expect(res?.status).toBe(401);
  });

  it("returns 401 when token is wrong", () => {
    vi.stubEnv("CRON_SECRET", "my-secret");
    const req = makeRequest({ authorization: "Bearer wrong-secret" });
    const res = requireCronAuth(req);
    expect(res?.status).toBe(401);
  });

  it("returns null (allowed) when token matches CRON_SECRET", () => {
    vi.stubEnv("CRON_SECRET", "my-secret");
    const req = makeRequest({ authorization: "Bearer my-secret" });
    const res = requireCronAuth(req);
    expect(res).toBeNull();
  });

  it("returns 500 in production when CRON_SECRET is not set", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const req = makeRequest({ authorization: "Bearer anything" });
    // auth.ts checks `if (!secret)` — empty string is falsy, same as unset
    const res = requireCronAuth(req);
    expect(res?.status).toBe(500);
  });

  it("returns null in development when CRON_SECRET is not set (fail open)", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    const req = makeRequest({ authorization: "Bearer anything" });
    const res = requireCronAuth(req);
    expect(res).toBeNull();
  });
});

describe("requireAppAuth", () => {
  beforeEach(() => {
    vi.mocked(verifySessionToken).mockResolvedValue("test.myshopify.com");
  });

  it("returns null when session token is valid", async () => {
    const req = makeRequest({ authorization: "Bearer valid-token" });
    const res = await requireAppAuth(req);
    expect(res).toBeNull();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    vi.mocked(verifySessionToken).mockResolvedValueOnce(null);
    const req = makeRequest({});
    const res = await requireAppAuth(req);
    expect(res?.status).toBe(401);
  });

  it("accepts matching x-autopilot-api-key as temporary embedded app fallback", async () => {
    vi.stubEnv("AUTOPILOT_API_KEY", "secret-key-123");
    const req = makeRequest({ "x-autopilot-api-key": "secret-key-123" });

    const res = await requireAppAuth(req);

    expect(res).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("requirePrivateApiKeyAuth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows a matching private API key", () => {
    vi.stubEnv("AUTOPILOT_API_KEY", "secret-key-123");
    const res = requirePrivateApiKeyAuth(makeRequest({ "x-autopilot-api-key": "secret-key-123" }));
    expect(res).toBeNull();
  });

  it("rejects a missing or wrong private API key", () => {
    vi.stubEnv("AUTOPILOT_API_KEY", "secret-key-123");
    expect(requirePrivateApiKeyAuth(makeRequest())?.status).toBe(401);
    expect(requirePrivateApiKeyAuth(makeRequest({ "x-autopilot-api-key": "wrong-key" }))?.status).toBe(401);
  });
});

describe("getSessionShop", () => {
  beforeEach(() => {
    vi.mocked(verifySessionToken).mockResolvedValue("test.myshopify.com");
  });

  it("returns shop domain from valid session token", async () => {
    const req = makeRequest({ authorization: "Bearer valid-token" });
    const shop = await getSessionShop(req);
    expect(shop).toBe("test.myshopify.com");
  });

  it("returns null when verifySessionToken returns null", async () => {
    vi.mocked(verifySessionToken).mockResolvedValueOnce(null);
    const req = makeRequest({});
    const shop = await getSessionShop(req);
    expect(shop).toBeNull();
  });

  it("does not treat private API-key auth as a shop session", async () => {
    vi.stubEnv("AUTOPILOT_API_KEY", "secret-key-123");
    vi.mocked(verifySessionToken).mockResolvedValue(null);
    const req = makeRequest({ "x-autopilot-api-key": "secret-key-123" });
    const shop = await getSessionShop(req);
    expect(shop).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("getSessionUser", () => {
  beforeEach(() => {
    vi.mocked(decodeSessionUser).mockResolvedValue("user-123");
  });

  it("returns user ID from valid session", async () => {
    const req = makeRequest({ authorization: "Bearer valid-token" });
    const user = await getSessionUser(req);
    expect(user).toBe("user-123");
  });

  it("returns null when decodeSessionUser returns null", async () => {
    vi.mocked(decodeSessionUser).mockResolvedValueOnce(null);
    const req = makeRequest({});
    const user = await getSessionUser(req);
    expect(user).toBeNull();
  });

  it("returns an 'api-key' actor when a valid x-autopilot-api-key header is present", async () => {
    // Private-tool auth path: no Bearer token, only the API key header.
    vi.stubEnv("AUTOPILOT_API_KEY", "secret-key-123");
    vi.mocked(decodeSessionUser).mockResolvedValue(null);
    const req = makeRequest({ "x-autopilot-api-key": "secret-key-123" });
    const user = await getSessionUser(req);
    expect(user).toBe("api-key");
    vi.unstubAllEnvs();
  });

  it("rejects a wrong x-autopilot-api-key", async () => {
    vi.stubEnv("AUTOPILOT_API_KEY", "secret-key-123");
    vi.mocked(decodeSessionUser).mockResolvedValue(null);
    const req = makeRequest({ "x-autopilot-api-key": "wrong-key" });
    const user = await getSessionUser(req);
    expect(user).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("authorizePermission", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.mocked(verifySessionToken).mockResolvedValue("test.myshopify.com");
    vi.mocked(decodeSessionUser).mockResolvedValue("user-123");
  });

  it("allows admin allowlisted actors to use any permission", async () => {
    vi.stubEnv("AUTOPILOT_ADMIN_ACTORS", "user-123");

    const decision = await authorizePermission(
      makeRequest({ authorization: "Bearer valid-token" }),
      PERMISSIONS.RECOMMENDATIONS_OVERRIDE,
    );

    expect(decision).toMatchObject({ allowed: true, actor: "user-123" });
  });

  it("allows actors listed for the requested permission", async () => {
    vi.stubEnv("AUTOPILOT_JOBS_RUN_ACTORS", "user-123");

    const decision = await authorizePermission(
      makeRequest({ authorization: "Bearer valid-token" }),
      PERMISSIONS.JOBS_RUN,
    );

    expect(decision).toMatchObject({ allowed: true, actor: "user-123" });
  });

  it("returns 403 for authenticated actors without permission", async () => {
    const decision = await authorizePermission(
      makeRequest({ authorization: "Bearer valid-token" }),
      PERMISSIONS.RECOMMENDATIONS_REVIEW,
    );

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.actor).toBe("user-123");
      expect(decision.response.status).toBe(403);
    }
  });

  it("returns 401 when no supported auth path is present", async () => {
    vi.mocked(verifySessionToken).mockResolvedValueOnce(null);

    const decision = await authorizePermission(makeRequest(), PERMISSIONS.JOBS_RUN);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.actor).toBeNull();
      expect(decision.response.status).toBe(401);
    }
  });

  it("grants private API-key callers explicit server-side permissions", async () => {
    vi.stubEnv("AUTOPILOT_API_KEY", "secret-key-123");
    vi.mocked(verifySessionToken).mockResolvedValueOnce(null);

    const decision = await authorizePermission(
      makeRequest({ "x-autopilot-api-key": "secret-key-123" }),
      PERMISSIONS.JOBS_RUN,
    );

    expect(decision).toMatchObject({ allowed: true, actor: "api-key" });
  });
});

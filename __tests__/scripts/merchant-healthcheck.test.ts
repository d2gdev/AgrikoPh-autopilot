import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve(process.cwd(), "scripts/merchant-healthcheck.mjs");

describe("merchant healthcheck", () => {
  it("uses Merchant API endpoints and user accessRights", () => {
    const source = readFileSync(scriptPath, "utf8");

    expect(source).toContain('const API_BASE = "https://merchantapi.googleapis.com"');
    expect(source).not.toContain("shoppingcontent.googleapis.com");
    expect(source).toContain('path: "/products/v1/accounts/{merchantId}/products"');
    expect(source).toContain("entry?.accessRights");
    expect(source).toContain('decodeURIComponent(user.name.split("/").at(-1) ?? "") === clientEmail');
    expect(source).toContain('entry?.state === "VERIFIED"');
    expect(source).toContain('path: "/accounts/v1/accounts/{merchantId}/users?pageSize=100"');
    expect(source).toContain("tolerateServerError: true");
  });
});

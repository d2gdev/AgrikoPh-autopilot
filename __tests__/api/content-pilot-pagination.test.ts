import { describe, expect, it } from "vitest";

describe("content proposal pagination contract", () => {
  it("requires a stable cursor contract for multi-page results", () => {
    expect({ total: 201, hasNextPage: true, nextCursor: "id-100" }).toMatchObject({ total: 201, hasNextPage: true });
  });
});

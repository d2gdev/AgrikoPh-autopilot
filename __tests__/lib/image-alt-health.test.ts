import { describe, expect, it } from "vitest";
import { imageAltHealth, needsAltReview } from "@/lib/image-alt-health";

describe("image alt health", () => {
  it("keeps missing, suspicious, and optimized values separate", () => {
    expect(imageAltHealth([
      { altText: null },
      { altText: "signed Henri Matisse" },
      { altText: "tor-brown-rice.jpg" },
      { altText: "Agriko organic brown rice in a bowl" },
    ])).toEqual({ missing: 1, needsReview: 2, optimized: 1 });
  });

  it("does not treat a legitimate phrase containing a file extension as a filename", () => {
    expect(needsAltReview("Download the brown rice guide.jpg version")).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const gsc = vi.hoisted(() => ({
  submit: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/connectors/gsc", () => ({
  submitGscSitemap: gsc.submit,
  listGscSitemaps: gsc.list,
}));

import {
  parseSubmitGscSitemapArguments,
  runSubmitGscSitemap,
} from "@/scripts/submit-gsc-sitemap";

describe("GSC sitemap submit command", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults to a zero-write root sitemap dry-run", async () => {
    const input = parseSubmitGscSitemapArguments([]);
    await expect(runSubmitGscSitemap(input)).resolves.toEqual({
      dryRun: true,
      sitemapUrl: "https://agrikoph.com/sitemap.xml",
      submitted: false,
      writeCount: 0,
    });
    expect(gsc.submit).not.toHaveBeenCalled();
  });

  it("submits once and requires API read-back", async () => {
    const sitemapUrl = "https://agrikoph.com/sitemap.xml";
    gsc.submit.mockResolvedValue({
      siteUrl: "sc-domain:agrikoph.com",
      sitemapUrl,
      submitted: true,
    });
    gsc.list.mockResolvedValue([{
      path: sitemapUrl,
      isPending: false,
      lastSubmitted: "2026-07-20T00:00:00.000Z",
    }]);

    await expect(runSubmitGscSitemap({ apply: true, sitemapUrl }))
      .resolves.toMatchObject({
        dryRun: false,
        submitted: true,
        writeCount: 1,
        readBack: { path: sitemapUrl, isPending: false },
      });
    expect(gsc.submit).toHaveBeenCalledOnce();
  });

  it("fails if the submitted sitemap is absent from read-back", async () => {
    gsc.submit.mockResolvedValue({ submitted: true });
    gsc.list.mockResolvedValue([]);

    await expect(runSubmitGscSitemap({
      apply: true,
      sitemapUrl: "https://agrikoph.com/sitemap.xml",
    })).rejects.toThrow(/absent from API read-back/i);
  });
});

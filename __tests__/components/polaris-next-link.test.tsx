import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} data-next-link="true" {...props}>{children}</a>
  ),
}));

import { PolarisNextLink } from "@/components/polaris-next-link";

describe("PolarisNextLink", () => {
  it("uses Next navigation for internal embedded links", () => {
    const html = renderToStaticMarkup(
      <PolarisNextLink url="/content-pilot?host=admin-host">Content</PolarisNextLink>,
    );

    expect(html).toContain('data-next-link="true"');
    expect(html).toContain('href="/content-pilot?host=admin-host"');
  });

  it("keeps external links as normal anchors", () => {
    const html = renderToStaticMarkup(
      <PolarisNextLink url="https://example.com" external>External</PolarisNextLink>,
    );

    expect(html).not.toContain("data-next-link");
    expect(html).toContain('target="_blank"');
  });
});

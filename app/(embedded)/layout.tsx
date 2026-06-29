"use client";

import { Providers } from "@/app/providers";
import { Frame, Navigation } from "@shopify/polaris";
import { ErrorBoundary } from "@/components/error-boundary";
import { AppBridgeAuthGate } from "@/components/app-bridge-auth-gate";
import { withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { EMBEDDED_NAVIGATION_SECTIONS, matchesNavigationItem } from "@/lib/navigation";
import { usePathname } from "next/navigation";

export default function EmbeddedLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navUrl = (href: string) => withShopifyContextUrl(href);

  const nav = (
    <Navigation location={pathname}>
      {EMBEDDED_NAVIGATION_SECTIONS.map((section, index) => (
        <Navigation.Section
          key={`${section.title ?? "primary"}-${index}`}
          title={section.title}
          separator={section.separator}
          items={section.items.map((item) => ({
            label: item.label,
            url: navUrl(item.href),
            matches: matchesNavigationItem(pathname, item),
          }))}
        />
      ))}
    </Navigation>
  );

  return (
    <Providers>
      <Frame navigation={nav}>
        <ErrorBoundary>
          <AppBridgeAuthGate>{children}</AppBridgeAuthGate>
        </ErrorBoundary>
      </Frame>
    </Providers>
  );
}

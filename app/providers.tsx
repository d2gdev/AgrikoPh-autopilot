"use client";

import { useEffect, useState } from "react";
import { AppProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import enTranslations from "@shopify/polaris/locales/en.json";
import { withShopifyContextUrl } from "@/hooks/use-auth-fetch";
import { getAppBridgeNavigationItems } from "@/lib/navigation";
import { PolarisNextLink } from "@/components/polaris-next-link";
import "@shopify/polaris/build/esm/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  const [isEmbedded, setIsEmbedded] = useState(false);

  useEffect(() => {
    setIsEmbedded(typeof (window as Window & { shopify?: unknown }).shopify !== "undefined");
  }, []);

  return (
    <AppProvider i18n={enTranslations} linkComponent={PolarisNextLink}>
      {isEmbedded && (
        <NavMenu>
          {getAppBridgeNavigationItems().map((item) => (
            <a
              key={item.href}
              href={withShopifyContextUrl(item.href)}
              rel={item.href === "/" ? "home" : undefined}
            >
              {item.label}
            </a>
          ))}
        </NavMenu>
      )}
      {children}
    </AppProvider>
  );
}

"use client";

import React from "react";
import { useAppBridgeAuth } from "@/hooks/use-auth-fetch";
import { Banner, BlockStack, Box, Button, InlineStack, Spinner, Text } from "@shopify/polaris";

const PolarisText = Text as React.ElementType;

export function AppBridgeAuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAppBridgeAuth();

  if (auth.status === "ready" && auth.initialized) {
    return React.createElement(React.Fragment, null, children);
  }

  if (auth.status === "error") {
    return React.createElement(
      Box,
      { padding: "400" },
      React.createElement(
        Banner,
        { title: "Unable to connect to Shopify Admin", tone: "critical" },
        React.createElement(
          BlockStack,
          { gap: "300" },
          React.createElement(
            PolarisText,
            { as: "p" },
            auth.error ?? "App Bridge authentication failed. Reload the app from Shopify Admin and try again.",
          ),
          React.createElement(
            InlineStack,
            { gap: "200" },
            React.createElement(Button, { onClick: () => window.location.reload() }, "Reload"),
          ),
        ),
      ),
    );
  }

  return React.createElement(
    Box,
    { padding: "400" },
    React.createElement(
      BlockStack,
      { gap: "300", align: "center" },
      React.createElement(Spinner, { accessibilityLabel: "Connecting to Shopify Admin", size: "large" }),
      React.createElement(PolarisText, { as: "p", tone: "subdued" }, "Connecting to Shopify Admin..."),
    ),
  );
}

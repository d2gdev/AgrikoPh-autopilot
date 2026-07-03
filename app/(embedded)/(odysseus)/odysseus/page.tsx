"use client";

import { useState } from "react";
import { Page, Card, Text, BlockStack, Spinner, InlineStack, Banner, Link } from "@shopify/polaris";

// Required explicitly — no fallback URL. NEXT_PUBLIC_ vars are inlined at build
// time, so the build environment's .env must set this (see .env.example).
const ODYSSEUS_URL = process.env.NEXT_PUBLIC_ODYSSEUS_URL;

export default function OdysseusPage() {
  const [loaded, setLoaded] = useState(false);

  if (!ODYSSEUS_URL) {
    return (
      <Page title="Odysseus Workspace">
        <Card>
          <BlockStack gap="300">
            <Banner tone="warning" title="Workspace not configured">
              <Text as="p">
                Set <code>NEXT_PUBLIC_ODYSSEUS_URL</code> in the build environment to embed the
                Odysseus workspace here. The variable is baked in at build time, so rebuild and
                redeploy after setting it.
              </Text>
            </Banner>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "calc(100vh - 56px)" }}>
      {!loaded && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <BlockStack gap="200" inlineAlign="center">
            <Spinner accessibilityLabel="Loading Odysseus workspace" size="large" />
            <Text as="p" tone="subdued">Loading workspace…</Text>
            <InlineStack gap="100">
              <Text as="span" tone="subdued" variant="bodySm">Not loading?</Text>
              <Link url={ODYSSEUS_URL} external>Open Odysseus in a new tab</Link>
            </InlineStack>
          </BlockStack>
        </div>
      )}
      <iframe
        src={ODYSSEUS_URL}
        onLoad={() => setLoaded(true)}
        style={{ width: "100%", height: "100%", border: "none", display: "block", position: "relative" }}
        allow="clipboard-read; clipboard-write"
        title="Odysseus Workspace"
      />
    </div>
  );
}

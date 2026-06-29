"use client";

import React from "react";
import { Banner, Button, Text, BlockStack } from "@shopify/polaris";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem" }}>
          <BlockStack gap="400">
            <Banner
              title="Something went wrong"
              tone="critical"
            >
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd">
                  {this.state.error?.message ?? "An unexpected error occurred."}
                </Text>
                <Button onClick={() => window.location.reload()}>
                  Reload page
                </Button>
              </BlockStack>
            </Banner>
          </BlockStack>
        </div>
      );
    }

    return this.props.children;
  }
}

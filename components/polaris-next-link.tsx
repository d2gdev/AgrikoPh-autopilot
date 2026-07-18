"use client";

import NextLink from "next/link";
import React, { forwardRef } from "react";
import type { LinkLikeComponentProps } from "@shopify/polaris/build/ts/src/utilities/link";

const EXTERNAL_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

export const PolarisNextLink = forwardRef<HTMLAnchorElement, LinkLikeComponentProps>(
  function PolarisNextLink({ url = "", external, children, ...props }, ref) {
    if (external || EXTERNAL_URL.test(url)) {
      return (
        <a ref={ref} href={url} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    }

    return (
      <NextLink ref={ref} href={url} {...props}>
        {children}
      </NextLink>
    );
  },
);

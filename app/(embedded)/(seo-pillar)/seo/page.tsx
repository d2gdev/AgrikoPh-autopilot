"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { withShopifyContextUrl } from "@/hooks/use-auth-fetch";

// /seo was a strict subset of /seo-pillar's Overview tab plus the AI brief,
// which now lives on the pillar dashboard (audit item 8) — folded 2026-07.
export default function SeoRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace(withShopifyContextUrl("/seo-pillar")); }, [router]);
  return null;
}

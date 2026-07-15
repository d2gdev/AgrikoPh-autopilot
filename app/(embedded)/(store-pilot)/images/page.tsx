"use client";

import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  Badge,
  InlineStack,
  BlockStack,
  Thumbnail,
  DataTable,
  Toast,
  Banner,
  TextField,
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";
import { timeAgo } from "@/lib/format";
import { ListSkeleton } from "@/components/ui/states";
import { needsAltReview } from "@/lib/image-alt-health";

interface ImageRow {
  imageId: string;
  productId: string;
  productTitle: string;
  imageUrl: string;
  altText: string | null;
}

interface PageData {
  images: ImageRow[];
  total: number;
  missingAltText: number;
  cachedAt?: string;
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "missing", label: "Missing" },
  { id: "review", label: "Needs review" },
  { id: "suggested", label: "Suggested" },
  { id: "set", label: "Set" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const IMAGES_CACHE_KEY = "/api/images";

export default function ImagesPage() {
  const authFetch = useAuthFetch();
  const [data, setData] = useState<PageData | null>(() => getCache<PageData>(IMAGES_CACHE_KEY));
  const [loading, setLoading] = useState(() => !getCache(IMAGES_CACHE_KEY));
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterId>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const loadImages = useCallback((refresh = false) => {
    setLoading(true);
    setLoadError(null);
    authFetch(refresh ? `${IMAGES_CACHE_KEY}?refresh=1` : IMAGES_CACHE_KEY)
      .then((r) => { if (!r.ok) throw new Error(`Images failed to load (${r.status})`); return r.json(); })
      .then((d) => { setCache(IMAGES_CACHE_KEY, d); setData(d); })
      .catch((err: Error) => setLoadError(err.message || "Images failed to load"))
      .finally(() => setLoading(false));
  }, [authFetch]);

  useEffect(() => { loadImages(); }, [loadImages]);

  const generate = useCallback(async (img: ImageRow): Promise<string | null> => {
    setGenerating((p) => new Set(p).add(img.imageId));
    setErrors((p) => { const n = { ...p }; delete n[img.imageId]; return n; });
    try {
      const res = await authFetch("/api/images", {
        method: "POST",
        body: JSON.stringify({ imageId: img.imageId, productId: img.productId, imageUrl: img.imageUrl, productTitle: img.productTitle }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setSuggestions((p) => ({ ...p, [img.imageId]: d.altText }));
      return d.altText as string;
    } catch {
      setErrors((p) => ({ ...p, [img.imageId]: "Failed — retry" }));
      return null;
    } finally {
      setGenerating((p) => { const n = new Set(p); n.delete(img.imageId); return n; });
    }
  }, [authFetch]); // authFetch from useCallback in hook — stable reference

  const generateAllMissing = useCallback(async () => {
    if (!data) return;
    setBulkRunning(true);
    const missing = data.images.filter((i) => !i.altText && !suggestions[i.imageId]);
    for (const img of missing) {
      await generate(img);
    }
    setBulkRunning(false);
    setToast({ message: "Suggestions generated — review and click Apply to write them to Shopify" });
  }, [data, suggestions, generate]);

  const applyAlt = useCallback(async (img: ImageRow, altText: string) => {
    setApplying((p) => new Set(p).add(img.imageId));
    try {
      const res = await authFetch("/api/images", {
        method: "PATCH",
        body: JSON.stringify({ imageId: img.imageId, productId: img.productId, altText }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error ?? `Apply failed (${res.status})`);
      setData((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          images: prev.images.map((i) => i.imageId === img.imageId ? { ...i, altText } : i),
          missingAltText: Math.max(0, prev.missingAltText - (img.altText ? 0 : 1)),
        };
        setCache(IMAGES_CACHE_KEY, next);
        return next;
      });
      setSuggestions((p) => { const n = { ...p }; delete n[img.imageId]; return n; });
      setToast({ message: "Alt text applied to Shopify" });
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : "Apply failed", error: true });
    } finally {
      setApplying((p) => { const n = new Set(p); n.delete(img.imageId); return n; });
    }
  }, [authFetch]);

  const copyAlt = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ message: "Copied to clipboard" });
    } catch {
      setToast({ message: "Copy failed — select the text manually", error: true });
    }
  }, []);

  const allImages = data?.images ?? [];
  const filterCounts: Record<FilterId, number> = {
    all: allImages.length,
    missing: allImages.filter((i) => !i.altText && !suggestions[i.imageId]).length,
    review: allImages.filter((i) => !!i.altText && needsAltReview(i.altText) && !suggestions[i.imageId]).length,
    suggested: allImages.filter((i) => !!suggestions[i.imageId]).length,
    set: allImages.filter((i) => !!i.altText && !needsAltReview(i.altText)).length,
  };
  const query = searchQuery.trim().toLowerCase();
  const filteredImages = allImages.filter((img) => {
    if (filter === "missing" && (img.altText || suggestions[img.imageId])) return false;
    if (filter === "review" && (!img.altText || !needsAltReview(img.altText) || suggestions[img.imageId])) return false;
    if (filter === "suggested" && !suggestions[img.imageId]) return false;
    if (filter === "set" && (!img.altText || needsAltReview(img.altText))) return false;
    return !query || img.productTitle.toLowerCase().includes(query);
  });

  const rows = filteredImages.map((img) => {
    const suggestion = suggestions[img.imageId];
    const isGenerating = generating.has(img.imageId);
    const hasError = errors[img.imageId];
    const requiresReview = needsAltReview(img.altText);

    const altTextCell = hasError ? (
      <Badge tone="critical">{hasError}</Badge>
    ) : suggestion ? (
      <Text as="span" variant="bodySm">{suggestion}</Text>
    ) : img.altText ? (
      <InlineStack gap="200" align="start">
        <Badge tone={requiresReview ? "warning" : "success"}>{requiresReview ? "Needs review" : "Set"}</Badge>
        <Text as="span" variant="bodySm" tone="subdued">{img.altText}</Text>
      </InlineStack>
    ) : (
      <Badge tone="critical">Missing</Badge>
    );

    const isApplying = applying.has(img.imageId);
    const actionCell = suggestion ? (
      <InlineStack gap="150">
        <Button size="slim" variant="primary" loading={isApplying} onClick={() => applyAlt(img, suggestion)}>
          Apply
        </Button>
        <Button size="slim" onClick={() => copyAlt(suggestion)}>Copy</Button>
        <Button size="slim" variant="plain" loading={isGenerating} onClick={() => generate(img)}>
          Regenerate
        </Button>
      </InlineStack>
    ) : img.altText && !hasError ? (
      requiresReview ? (
        <Button size="slim" onClick={() => generate(img)} loading={isGenerating}>
          Regenerate
        </Button>
      ) : (
      <></>
      )
    ) : (
      <Button size="slim" onClick={() => generate(img)} loading={isGenerating}>
        {hasError ? "Retry" : "Generate"}
      </Button>
    );

    return [
      img.productTitle,
      <Thumbnail key={img.imageId} source={img.imageUrl} alt={img.altText ?? ""} size="small" />,
      altTextCell,
      actionCell,
    ];
  });

  return (
    <>
      <Page
        title="Image Optimization"
        primaryAction={
          <Button
            variant="primary"
            onClick={generateAllMissing}
            loading={bulkRunning}
            disabled={!data || data.missingAltText === 0}
          >
            Generate All Missing
          </Button>
        }
      >
        <Layout>
          {loadError && (
            <Layout.Section>
              <Banner
                tone="critical"
                title="Failed to load images"
                action={{ content: "Retry", onAction: () => loadImages() }}
                onDismiss={() => setLoadError(null)}
              >
                <Text as="p">{loadError}</Text>
              </Banner>
            </Layout.Section>
          )}
          <Layout.Section>
            <BlockStack gap="200">
              <InlineStack gap="400" wrap={false}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h2">Total Images</Text>
                    <Text variant="heading2xl" as="p">{data?.total ?? "—"}</Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h2">Missing Alt Text</Text>
                    <Text variant="heading2xl" as="p">{data?.missingAltText ?? "—"}</Text>
                  </BlockStack>
                </Card>
              </InlineStack>
              {data?.cachedAt && (
                <Text as="p" variant="bodySm" tone="subdued">Updated {timeAgo(data.cachedAt)}</Text>
              )}
            </BlockStack>
          </Layout.Section>

          <Layout.Section>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="end" wrap>
                <InlineStack gap="100">
                  {FILTERS.map((f) => (
                    <Button
                      key={f.id}
                      size="slim"
                      variant={filter === f.id ? "primary" : undefined}
                      onClick={() => setFilter(f.id)}
                    >
                      {`${f.label} (${loading ? "…" : filterCounts[f.id]})`}
                    </Button>
                  ))}
                </InlineStack>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <TextField label="Search products" labelHidden placeholder="Search…" value={searchQuery} onChange={setSearchQuery}
                    autoComplete="off" clearButton onClearButtonClick={() => setSearchQuery("")} />
                </div>
              </InlineStack>
              <Card>
                {loading ? (
                  <ListSkeleton lines={6} />
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text"]}
                    headings={["Product", "Image", "Alt Text", "Action"]}
                    rows={rows}
                  />
                )}
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Page>

      {toast && (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  );
}

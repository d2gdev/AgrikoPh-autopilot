import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { useCallback, useEffect, useState } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { draftFailureMessage } from "./helpers";
import type {
  ContentMapSuggestion,
  ContentMapSuggestionsResponse,
} from "./types";

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: `Server returned non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}` };
  }
}

const roadmapDate = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: "Asia/Manila",
});

function formatRoadmapDate(value: string): string {
  return roadmapDate.format(new Date(value));
}

export function BriefTab({
  authFetch,
}: {
  authFetch: ReturnType<typeof useAuthFetch>;
}) {
  const [suggestions, setSuggestions] = useState<ContentMapSuggestionsResponse | null>(null);
  const [selected, setSelected] = useState<ContentMapSuggestion | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposalCreated, setProposalCreated] = useState(false);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch("/api/content-pilot/map-suggestions");
      const data = await safeJson(response);
      if (!response.ok) {
        setSuggestions(null);
        setError((data.error as string) ?? "Mapped content work is unavailable.");
        return;
      }
      setSuggestions(data as unknown as ContentMapSuggestionsResponse);
    } catch (loadError) {
      setSuggestions(null);
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  const generateBrief = useCallback(async (suggestion: ContentMapSuggestion) => {
    if (!suggestions) return;
    setSelected(suggestion);
    setGenerating(true);
    setBrief(null);
    setError(null);
    setProposalCreated(false);
    try {
      const response = await authFetch("/api/content-pilot/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyVersionId: suggestions.strategy.versionId,
          packageSha256: suggestions.strategy.packageSha256,
          analysisGeneratedAt: suggestions.strategy.analysisGeneratedAt,
          candidateId: suggestion.candidateId,
        }),
      });
      const data = await safeJson(response);
      if (!response.ok) {
        setError(draftFailureMessage(data, "Brief generation failed"));
        return;
      }
      setBrief(data.brief as string);
    } catch (briefError) {
      setError(String(briefError));
    } finally {
      setGenerating(false);
    }
  }, [authFetch, suggestions]);

  const promoteSelected = useCallback(async () => {
    if (!suggestions || !selected) return;
    setPromoting(true);
    setError(null);
    try {
      const response = await authFetch("/api/seo/gaps/promote-selected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyVersionId: suggestions.strategy.versionId,
          packageSha256: suggestions.strategy.packageSha256,
          analysisGeneratedAt: suggestions.strategy.analysisGeneratedAt,
          candidateIds: [selected.candidateId],
        }),
      });
      const data = await safeJson(response);
      if (!response.ok) {
        setError((data.error as string) ?? "Mapped content work could not be sent to the Queue.");
        return;
      }
      const counts = data.counts as Record<string, number> | undefined;
      if ((counts?.created ?? 0) + (counts?.already_existing ?? 0) < 1) {
        setError("The mapped candidate changed or is no longer actionable.");
        return;
      }
      setProposalCreated(true);
      setBrief(null);
      setSelected(null);
      await loadSuggestions();
    } catch (promotionError) {
      setError(String(promotionError));
    } finally {
      setPromoting(false);
    }
  }, [authFetch, loadSuggestions, selected, suggestions]);

  return (
    <BlockStack gap="400">
      {error && (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {proposalCreated && (
        <Banner tone="success" onDismiss={() => setProposalCreated(false)}>
          Mapped work sent to the Queue for operator review.
        </Banner>
      )}
      <Banner tone="info">
        Content Pilot uses only exact URLs and decisions from the active topical map.
      </Banner>

      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="headingMd" as="h2">Available now</Text>
            {loading && <Badge tone="info">Loading</Badge>}
          </InlineStack>
          {suggestions?.currentWork.status === "refresh_required" && (
            <Banner tone="warning">
              Current analysis needs refreshing. Current actions are unavailable, but the mapped roadmap remains visible.
            </Banner>
          )}
          {!loading
            && suggestions?.currentWork.status === "current"
            && suggestions.actionable.length === 0 && (
            <Text as="p" tone="subdued">No mapped content work is currently actionable.</Text>
          )}
          {suggestions?.actionable.map((item) => (
            <Box key={item.candidateId} paddingBlockEnd="300">
              <BlockStack gap="150">
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Text as="h3" variant="headingSm">{item.title}</Text>
                  <Badge>{item.priority}</Badge>
                  <Badge tone="success">{item.action}</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">{item.targetUrl}</Text>
                <Text as="p">{item.decision}</Text>
                <InlineStack>
                  <Button
                    size="slim"
                    onClick={() => generateBrief(item)}
                    loading={generating && selected?.candidateId === item.candidateId}
                    disabled={generating || promoting}
                  >
                    {item.action === "refresh" ? "Generate refresh brief" : "Generate mapped brief"}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Box>
          ))}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h2">Upcoming mapped phases</Text>
          {!loading && suggestions?.upcoming.length === 0 && (
            <Text as="p" tone="subdued">No future mapped phases are currently scheduled.</Text>
          )}
          {suggestions?.upcoming.map((item) => (
            <Box key={item.taskId} paddingBlockEnd="300">
              <BlockStack gap="150">
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Text as="h3" variant="headingSm">{item.title}</Text>
                  <Badge>{item.priority}</Badge>
                  <Badge tone="info">Upcoming</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">
                  Review window: {formatRoadmapDate(item.earliestReviewAt)}
                  {item.dueAt ? ` – ${formatRoadmapDate(item.dueAt)}` : ""}
                </Text>
                {item.obligations.split("\n").map((obligation) => (
                  <Text key={obligation} as="p">{obligation}</Text>
                ))}
              </BlockStack>
            </Box>
          ))}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h2">Mapped research only</Text>
          {!loading && suggestions?.research.length === 0 && (
            <Text as="p" tone="subdued">No mapped items are waiting on research or review.</Text>
          )}
          {suggestions?.research.map((item) => (
            <Box key={`${item.targetUrl}:${item.reason}`} paddingBlockEnd="300">
              <BlockStack gap="150">
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Text as="h3" variant="headingSm">{item.title}</Text>
                  <Badge>{item.priority}</Badge>
                  <Badge tone="attention">Research only</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">{item.targetUrl}</Text>
                <Text as="p">{item.decision}</Text>
                <Text as="p" tone="subdued">Gate: {item.reason}</Text>
              </BlockStack>
            </Box>
          ))}
        </BlockStack>
      </Card>

      {brief && selected && (
        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center" gap="200">
              <Text variant="headingMd" as="h2">Mapped content brief</Text>
              <Badge tone="info">{selected.title}</Badge>
            </InlineStack>
            <Box>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "14px", lineHeight: "1.6" }}>
                {brief}
              </pre>
            </Box>
            <InlineStack gap="200">
              <Button size="slim" onClick={() => { setBrief(null); setSelected(null); }}>
                Clear
              </Button>
              <Button
                variant="primary"
                onClick={promoteSelected}
                loading={promoting}
                disabled={promoting}
              >
                Send mapped work to Queue
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}

import {
  BlockStack,
  Banner,
  Card,
  Text,
  InlineStack,
  Button,
  TextField,
  Select,
  Badge,
  Box,
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";

import type { TopicCluster } from "./types";
import { draftFailureMessage } from "./helpers";

// Safely parse a Response as JSON. If the body is not JSON (e.g. an HTML error
// page from a proxy or Next.js itself), returns { error: <raw text> } rather
// than throwing SyntaxError: Unexpected token '<'.
async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { return { error: `Server returned non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}` }; }
}

// ── Brief Tab ──────────────────────────────────────────────────────────────

export function BriefTab({
  authFetch,
  clusters,
}: {
  authFetch: ReturnType<typeof useAuthFetch>;
  clusters: TopicCluster[];
}) {
  const [topic, setTopic] = useState("");
  const [brief, setBrief] = useState<string | null>(null);
  const [briefTopic, setBriefTopic] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposalCreated, setProposalCreated] = useState(false);
  const [blogs, setBlogs] = useState<Array<{id: string; title: string; handle: string}>>([]);
  const [selectedBlog, setSelectedBlog] = useState("");
  const [blogsError, setBlogsError] = useState(false);

  useEffect(() => {
    authFetch("/api/content-pilot/blogs")
      .then(async (r) => {
        if (!r.ok) {
          setBlogsError(true);
          return { blogs: [] };
        }
        setBlogsError(false);
        return await safeJson(r) as { blogs?: Array<{id: string; title: string; handle: string}> };
      })
      .then((d: { blogs?: Array<{id: string; title: string; handle: string}> }) => setBlogs(d.blogs ?? []))
      .catch(() => setBlogsError(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const topGaps = clusters.slice().sort((a, b) => b.gapScore - a.gapScore).slice(0, 5);

  const generate = useCallback(
    async (t: string) => {
      const resolved = t.trim();
      if (!resolved) return;
      setGenerating(true);
      setError(null);
      setProposalCreated(false);
      setBrief(null);
      setBriefTopic(null);
      try {
        const res = await authFetch("/api/content-pilot/brief", {
          method: "POST",
          body: JSON.stringify({ topic: resolved }),
        });
        const d = await safeJson(res);
        if (!res.ok) {
          setError(draftFailureMessage(d, "Brief generation failed"));
        } else {
          setBrief(d.brief as string);
          setBriefTopic(resolved);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setGenerating(false);
        setActiveChip(null);
      }
    },
    [authFetch]
  );

  const createProposal = async () => {
    const proposalTopic = (briefTopic ?? topic).trim();
    if (!proposalTopic || !brief) {
      setError("Generate a brief before creating a proposal.");
      return;
    }
    setCreatingProposal(true);
    setError(null);
    try {
      const res = await authFetch("/api/content-pilot/proposals/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: proposalTopic, brief, blogHandle: selectedBlog || null }),
      });
      const d = await safeJson(res);
      if (!res.ok) { setError((d.error as string) ?? "Failed to create proposal"); }
      else { setBrief(null); setBriefTopic(null); setTopic(""); setError(null); setProposalCreated(true); }
    } catch (e) { setError(String(e)); }
    finally { setCreatingProposal(false); }
  };

  const handleChipClick = (chipTopic: string) => {
    setTopic(chipTopic);
    setActiveChip(chipTopic);
    generate(chipTopic);
  };

  return (
    <BlockStack gap="400">
      {error && (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {proposalCreated && (
        <Banner tone="success" onDismiss={() => setProposalCreated(false)}>
          Proposal created. Switch to the <strong>Queue</strong> tab to review and generate it.
        </Banner>
      )}
      {blogsError && (
        <Banner tone="warning">
          Shopify blogs could not be loaded. New proposals will use the default blog until this page is refreshed successfully.
        </Banner>
      )}

      <Banner tone="info">
        Generate a brief, review it, then create a Queue proposal. The Queue tab is where drafts are generated and published.
      </Banner>

      {topGaps.length > 0 && (
        <Card>
          <BlockStack gap="200">
            <Text variant="headingSm" as="h3" tone="subdued">
              Top content gaps — click to generate brief
            </Text>
            <InlineStack gap="200" wrap>
              {topGaps.map((c) => {
                const isActive = activeChip === c.topic;
                return (
                  <Button
                    key={c.topic}
                    size="slim"
                    variant={isActive ? "primary" : "secondary"}
                    loading={isActive && generating}
                    disabled={generating && !isActive}
                    onClick={() => handleChipClick(c.topic)}
                  >
                    {c.topic}
                  </Button>
                );
              })}
            </InlineStack>
          </BlockStack>
        </Card>
      )}

      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h2">
            Custom Topic
          </Text>
          {/* Fix #1 — restore description so user knows what they'll get */}
          <Text as="p" tone="subdued">
            Enter a topic or keyword to generate a structured content brief — target keyword,
            recommended structure, H2 suggestions, and word count target.
          </Text>
          <TextField
            label="Topic or keyword"
            value={topic}
            onChange={setTopic}
            placeholder="e.g. moringa benefits for digestion"
            autoComplete="off"
          />
          {blogs.length > 1 && (
            <Select
              label="Publish to blog"
              options={[
                { label: "Default blog", value: "" },
                ...blogs.map(b => ({ label: b.title, value: b.handle })),
              ]}
              value={selectedBlog}
              onChange={setSelectedBlog}
            />
          )}
          <InlineStack>
            <Button
              variant="primary"
              onClick={() => generate(topic)}
              loading={generating && !activeChip}
              disabled={!topic.trim() || generating}
            >
              Generate Brief
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>

      {brief && (
        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center" gap="200" wrap={false}>
              <Text variant="headingMd" as="h2">
                Content Brief
              </Text>
              {briefTopic && <Badge tone="info">{briefTopic}</Badge>}
            </InlineStack>
            <Banner tone="success">
              Brief generated. Create a proposal to send this topic to the Queue, then generate the draft from there.
            </Banner>
            <Box>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  fontSize: "14px",
                  lineHeight: "1.6",
                }}
              >
                {brief}
              </pre>
            </Box>
            <InlineStack gap="200">
              <Button size="slim" onClick={() => setBrief(null)}>
                Clear
              </Button>
              <Button variant="primary" onClick={createProposal} loading={creatingProposal} disabled={!brief || creatingProposal}>
                Create Queue Proposal
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}

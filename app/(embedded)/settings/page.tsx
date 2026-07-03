"use client";

import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Divider,
  Banner,
  DataTable,
  Modal,
  Badge,
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { ReviewerAssignmentsCard } from "./ReviewerAssignmentsCard";

interface Credential {
  key: string;
  updatedAt: string;
  updatedBy: string | null;
}

interface GuardrailConfig {
  key: string;
  value: string;
  label: string;
  valueType: string;
}

interface ConnectorHealth {
  id: string;
  label: string;
  status: "configured" | "partial" | "missing";
  sources: Array<{ key: string; source: "db" | "env" }>;
  missing: string[];
  notes: string[];
  lastStatus?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
}

export default function SettingsPage() {
  const authFetch = useAuthFetch();
  const [guardrails, setGuardrails] = useState<GuardrailConfig[]>([]);
  const [saving, setSaving] = useState(false);
  const [guardrailsLoaded, setGuardrailsLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [connectorHealth, setConnectorHealth] = useState<ConnectorHealth[]>([]);
  const [connectorHealthLoaded, setConnectorHealthLoaded] = useState(false);
  const [newCredKey, setNewCredKey] = useState("");
  const [newCredValue, setNewCredValue] = useState("");
  const [credSaving, setCredSaving] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [credSuccess, setCredSuccess] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadGuardrails = useCallback(() => {
    authFetch("/api/settings")
      .then((r) => { if (!r.ok) throw new Error(`Settings failed to load (${r.status})`); return r.json(); })
      .then((d) => { setGuardrails(d.guardrails ?? []); setGuardrailsLoaded(true); })
      .catch((err: Error) => setLoadError(err.message || "Settings failed to load"));
  }, [authFetch]);

  useEffect(() => { loadGuardrails(); }, [loadGuardrails]);

  function updateValue(key: string, value: string) {
    setGuardrails((prev) =>
      prev.map((g) => (g.key === key ? { ...g, value } : g))
    );
  }

  async function saveGuardrails() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await authFetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ guardrails }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSaveError((err as { error?: string }).error ?? "Failed to save settings");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }

  const loadCredentials = useCallback(() => {
    authFetch("/api/settings/credentials")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => setCredentials(d.credentials ?? []))
      .catch(() => setLoadError("Credentials failed to load"));
  }, [authFetch]);

  const loadConnectorHealth = useCallback((forceRefresh = false) => {
    setConnectorHealthLoaded(false);
    authFetch(forceRefresh ? "/api/settings/connector-health?refresh=1" : "/api/settings/connector-health")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => setConnectorHealth(d.connectors ?? []))
      .catch(() => setLoadError("Connector health failed to load"))
      .finally(() => setConnectorHealthLoaded(true));
  }, [authFetch]);

  useEffect(() => { loadCredentials(); }, [loadCredentials]);
  useEffect(() => { loadConnectorHealth(); }, [loadConnectorHealth]);

  const saveCredential = useCallback(async () => {
    if (!newCredKey.trim() || !newCredValue.trim()) return;
    setCredSaving(true);
    setCredError(null);
    setCredSuccess(null);
    try {
      const res = await authFetch("/api/settings/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: newCredKey.trim().toUpperCase(), value: newCredValue.trim() }),
      });
      const d = await res.json();
      if (!res.ok) { setCredError(d.error ?? "Save failed"); }
      else {
        setCredSuccess(`Saved ${d.credential.key}`);
        setNewCredKey("");
        setNewCredValue("");
        loadCredentials();
        loadConnectorHealth(true);
      }
    } catch (err) {
      setCredError(String(err));
    } finally {
      setCredSaving(false);
    }
  }, [authFetch, newCredKey, newCredValue, loadCredentials, loadConnectorHealth]);

  const deleteCredential = useCallback(async (key: string) => {
    setCredError(null);
    setCredSuccess(null);
    try {
      const res = await authFetch(`/api/settings/credentials/${key}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setCredError((d as { error?: string }).error ?? `Failed to delete ${key} (${res.status})`);
        return;
      }
      setCredSuccess(`Deleted ${key}`);
      loadCredentials();
      loadConnectorHealth(true);
    } catch (err) {
      setCredError(String(err));
    }
  }, [authFetch, loadCredentials, loadConnectorHealth]);

  const hardBlocks = guardrails.filter((g) =>
    g.key.startsWith("HARD_BLOCK")
  );
  const softFlags = guardrails.filter((g) =>
    g.key.startsWith("SOFT_FLAG")
  );

  function connectorBadge(status: ConnectorHealth["status"]) {
    if (status === "configured") return <Badge tone="success">Configured</Badge>;
    if (status === "partial") return <Badge tone="warning">Partial</Badge>;
    return <Badge tone="critical">Missing</Badge>;
  }

  function formatDate(value?: string | null) {
    return value ? new Date(value).toLocaleString() : "Never";
  }

  return (
    <Page title="Settings">
      <Layout>
        {saved && (
          <Layout.Section>
            <Banner tone="success">Settings saved.</Banner>
          </Layout.Section>
        )}
        {saveError && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setSaveError(null)}>{saveError}</Banner>
          </Layout.Section>
        )}
        {loadError && (
          <Layout.Section>
            <Banner
              tone="critical"
              title="Failed to load settings"
              action={{ content: "Retry", onAction: () => { setLoadError(null); loadGuardrails(); loadCredentials(); loadConnectorHealth(true); } }}
              onDismiss={() => setLoadError(null)}
            >
              <Text as="p">{loadError} — the Save button stays disabled until settings load.</Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Guardrails — Hard Blocks</Text>
              <Text as="p" tone="subdued">
                Recommendations that exceed these thresholds are blocked and require
                an explicit override with written justification.
              </Text>
              <FormLayout>
                {hardBlocks.map((g) => (
                  <TextField
                    key={g.key}
                    label={g.label}
                    value={g.value}
                    onChange={(v) => updateValue(g.key, v)}
                    type={g.valueType === "number" || g.valueType === "currency" ? "number" : "text"}
                    autoComplete="off"
                  />
                ))}
              </FormLayout>

              <Divider />

              <Text variant="headingMd" as="h2">Guardrails — Soft Flags</Text>
              <Text as="p" tone="subdued">
                Recommendations that exceed these thresholds are shown with a warning
                but can be approved normally by one person.
              </Text>
              <FormLayout>
                {softFlags.map((g) => (
                  <TextField
                    key={g.key}
                    label={g.label}
                    value={g.value}
                    onChange={(v) => updateValue(g.key, v)}
                    type={g.valueType === "number" || g.valueType === "currency" ? "number" : "text"}
                    autoComplete="off"
                  />
                ))}
              </FormLayout>

              <Button
                variant="primary"
                onClick={saveGuardrails}
                loading={saving}
                disabled={!guardrailsLoaded}
              >
                Save Guardrails
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">Connector Health</Text>
                  <Text as="p" tone="subdued">
                    Configuration status only. This does not call external APIs or expose credential values.
                  </Text>
                </BlockStack>
                <Button onClick={() => loadConnectorHealth(true)} disabled={!connectorHealthLoaded}>Refresh</Button>
              </InlineStack>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                headings={["Connector", "Status", "Sources", "Missing", "Last Success", "Last Error"]}
                rows={connectorHealth.map((connector) => [
                  connector.label,
                  connectorBadge(connector.status),
                  connector.sources.length
                    ? connector.sources.map((source) => `${source.key}: ${source.source}`).join(", ")
                    : "None",
                  connector.missing.length ? connector.missing.join(", ") : "None",
                  formatDate(connector.lastSuccessAt),
                  connector.lastError ?? connector.lastStatus ?? "None",
                ])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">API Credentials</Text>
              <Text as="p" tone="subdued">
                Stored encrypted with AES-256-GCM. Values are never exposed in the UI after saving.
              </Text>
              {credError && <Banner tone="critical" onDismiss={() => setCredError(null)}>{credError}</Banner>}
              {credSuccess && <Banner tone="success" onDismiss={() => setCredSuccess(null)}>{credSuccess}</Banner>}

              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">Stored Credentials</Text>
                {credentials.length === 0 ? (
                  <Text as="p" tone="subdued">No credentials stored yet.</Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text"]}
                    headings={["Key", "Last Updated", "Actions"]}
                    rows={credentials.map((c) => [
                      c.key,
                      new Date(c.updatedAt).toLocaleDateString(),
                      <Button key={c.key} tone="critical" size="slim" onClick={() => { setKeyToDelete(c.key); setDeleteModalOpen(true); }}>Delete</Button>,
                    ])}
                  />
                )}
              </BlockStack>

              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">Add / Update Credential</Text>
                <InlineStack gap="200" align="end">
                  <TextField
                    label="Key"
                    value={newCredKey}
                    onChange={setNewCredKey}
                    placeholder="META_ACCESS_TOKEN"
                    autoComplete="off"
                  />
                  <TextField
                    label="Value"
                    value={newCredValue}
                    onChange={setNewCredValue}
                    type="password"
                    placeholder="Paste credential value"
                    autoComplete="off"
                  />
                  <Button onClick={saveCredential} loading={credSaving} variant="primary">Save</Button>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <ReviewerAssignmentsCard />
        </Layout.Section>
      </Layout>

      <Modal
        open={deleteModalOpen}
        onClose={() => { setDeleteModalOpen(false); setKeyToDelete(null); }}
        title="Delete credential"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: () => { if (keyToDelete) deleteCredential(keyToDelete); setDeleteModalOpen(false); setKeyToDelete(null); },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => { setDeleteModalOpen(false); setKeyToDelete(null); } }]}
      >
        <Modal.Section>
          <Text as="p">Are you sure you want to delete <strong>{keyToDelete}</strong>? This cannot be undone.</Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

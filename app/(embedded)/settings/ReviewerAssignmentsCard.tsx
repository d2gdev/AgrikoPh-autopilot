"use client";

import { Card, Text, BlockStack, InlineStack, Select, Button, Banner, Spinner, Badge } from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";

interface Assignment {
  role: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  backupUserId: string | null;
  backupUserName: string | null;
  configured: boolean;
}
interface AppUser { shopifyUserId: string; displayName: string | null; email: string | null; }

const ROLE_LABELS: Record<string, string> = {
  CONVERSION_REVIEWER: "Conversion Reviewer",
  PENULTIMATE_APPROVER: "Penultimate Approver",
  FINAL_APPROVER: "Final Approver",
};

async function responseError(res: Response, fallback: string) {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof data.error === "string" ? data.error : `${fallback} (${res.status})`;
}

export function ReviewerAssignmentsCard() {
  const authFetch = useAuthFetch();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { assigned: string; backup: string }>>({});

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      authFetch("/api/settings/reviewer-assignments").then(async (r) => {
        if (!r.ok) throw new Error(await responseError(r, "Failed to load assignments"));
        return r.json();
      }),
      authFetch("/api/app-users").then(async (r) => (r.ok ? r.json() : { users: [] })),
    ])
      .then(([a, u]) => {
        setAssignments(a.assignments ?? []);
        setUsers(u.users ?? []);
        setDrafts(
          Object.fromEntries(
            (a.assignments ?? []).map((x: Assignment) => [x.role, { assigned: x.assignedUserId ?? "", backup: x.backupUserId ?? "" }]),
          ),
        );
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  const userOptions = [
    { label: "— select —", value: "" },
    ...users.map((u) => ({ label: u.displayName || u.shopifyUserId, value: u.shopifyUserId })),
  ];

  async function save(role: string) {
    const draft = drafts[role];
    if (!draft?.assigned) { setErr("Select a user to assign — roles cannot be left unassigned."); return; }
    setSavingRole(role);
    setErr(null);
    try {
      const res = await authFetch(`/api/settings/reviewer-assignments/${role}`, {
        method: "PUT",
        body: JSON.stringify({ assigned_user_id: draft.assigned, backup_user_id: draft.backup || null }),
      });
      if (!res.ok) throw new Error(await responseError(res, "Save failed"));
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRole(null);
    }
  }

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Ad Approval reviewers</Text>
        <Text as="p" tone="subdued">
          Assign the three reviewer roles. All roles must always be assigned; you can reassign but not clear a role.
          People appear here once they have opened the app.
        </Text>
        {err && <Banner tone="critical" onDismiss={() => setErr(null)}>{err}</Banner>}
        {loading ? (
          <InlineStack align="center"><Spinner accessibilityLabel="Loading" size="small" /></InlineStack>
        ) : (
          assignments.map((a) => (
            <BlockStack gap="150" key={a.role}>
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" variant="headingSm">{ROLE_LABELS[a.role] ?? a.role}</Text>
                {a.configured ? <Badge tone="success">Assigned</Badge> : <Badge tone="critical">Unassigned</Badge>}
              </InlineStack>
              <InlineStack gap="200" blockAlign="end" wrap>
                <Select label="Assigned" options={userOptions} value={drafts[a.role]?.assigned ?? ""}
                  onChange={(v) => setDrafts((p) => ({ ...p, [a.role]: { ...p[a.role]!, assigned: v } }))} />
                <Select label="Backup (optional)" options={userOptions} value={drafts[a.role]?.backup ?? ""}
                  onChange={(v) => setDrafts((p) => ({ ...p, [a.role]: { ...p[a.role]!, backup: v } }))} />
                <Button loading={savingRole === a.role} onClick={() => save(a.role)}>Save</Button>
              </InlineStack>
            </BlockStack>
          ))
        )}
      </BlockStack>
    </Card>
  );
}

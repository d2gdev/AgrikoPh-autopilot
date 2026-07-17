// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-auth-fetch", () => ({ useAuthFetch: () => authFetch }));
vi.mock("@shopify/polaris", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Page = ({ title, subtitle, primaryAction, secondaryActions, children }: any) => (
    <main>
      <h1>{title}</h1><p>{subtitle}</p>
      {primaryAction && <button onClick={primaryAction.onAction}>{primaryAction.content}</button>}
      {secondaryActions?.map((action: any) => <button key={action.content} onClick={action.onAction}>{action.content}</button>)}
      {children}
    </main>
  );
  const Button = ({ children, onClick, onAction, disabled, loading, accessibilityLabel }: any) => (
    <button
      aria-label={accessibilityLabel}
      onClick={onClick ?? onAction}
      disabled={disabled || loading}
    >
      {children}
    </button>
  );
  const Text = ({ children }: any) => <span>{children}</span>;
  const Badge = ({ children }: any) => <span>{children}</span>;
  const Banner = ({ children, title }: any) => <div role="alert">{title}{children}</div>;
  const TextField = ({ label, value, onChange, multiline, type }: any) => (
    <label>{label}{multiline
      ? <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
      : <input aria-label={label} type={type ?? "text"} value={value} onChange={(event) => onChange(event.target.value)} />}</label>
  );
  const Select = ({ label, value, options, onChange }: any) => (
    <label>{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
  );
  const Checkbox = ({ label, checked, onChange }: any) => (
    <label><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>
  );
  const Pagination = ({ hasPrevious, hasNext, onPrevious, onNext }: any) => (
    <div><button disabled={!hasPrevious} onClick={onPrevious}>Previous page</button><button disabled={!hasNext} onClick={onNext}>Next page</button></div>
  );
  return {
    Page,
    Layout: Object.assign(passthrough, { Section: passthrough }),
    Card: passthrough,
    BlockStack: passthrough,
    InlineStack: passthrough,
    InlineGrid: passthrough,
    Box: passthrough,
    Divider: () => <hr />,
    Text,
    Badge,
    Banner,
    Button,
    TextField,
    Select,
    Checkbox,
    Pagination,
    SkeletonBodyText: () => <div>Loading SEO tasks</div>,
  };
});

import SeoTasksPage from "@/app/(embedded)/(seo-pillar)/seo-tasks/page";

afterEach(cleanup);

const task = {
  id: "task-1",
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
  version: 1,
  taskType: "ctr_experiment_review",
  title: "Rice nutrition CTR",
  description: "Review clicks, impressions, CTR, and query mix.",
  targetUrl: "/blogs/news/rice-nutrition-breakdown",
  topicalCluster: "rice-nutrition",
  pageRole: "nutrition-pillar",
  ownerSurface: "seo",
  destinationPath: "/seo-pillar",
  priority: "P1",
  earliestReviewAt: "2026-07-17T00:00:00.000Z",
  dueAt: null,
  requiresEvidence: true,
  evidenceRequirement: { metrics: ["clicks", "impressions", "ctr"] },
  evidenceStatus: "sufficient",
  evidenceSnapshot: { clicks: 4, impressions: 120 },
  lastEvaluatedAt: "2026-07-18T00:00:00.000Z",
  sourceType: "operator",
  sourceKey: "rice-ctr-july",
  sourceData: {},
  status: "open",
  completedAt: null,
  completionNote: null,
  decisionData: null,
  dedupeKey: "hidden",
  bucket: "ready",
  overdue: false,
};

const list = {
  tasks: [task],
  total: 1,
  page: 1,
  pageSize: 25,
  hasMore: false,
  counts: { ready: 1, waiting: 2, scheduled: 3, closed: 4 },
  asOf: "2026-07-18T00:00:00.000Z",
};

function response(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body });
}

describe("SEO Tasks workboard", () => {
  beforeEach(() => {
    authFetch.mockReset();
    authFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/seo/tasks?") && !init) return response(list);
      if (url === "/api/seo/tasks/task-1") return response({ task, history: [] });
      if (url === "/api/seo/tasks" && init?.method === "POST") return response({ task: { ...task, id: "task-2" } });
      if (url === "/api/seo/tasks/task-1" && init?.method === "PATCH") {
        return response({ task: { ...task, version: 2, status: "completed" } });
      }
      throw new Error(`Unexpected request ${url}`);
    });
  });

  it("renders truthful bucket counts and expands row details inline", async () => {
    render(<SeoTasksPage />);
    expect(screen.getByText("Loading SEO tasks")).toBeTruthy();
    expect(await screen.findByText("Rice nutrition CTR")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ready now, 1 task" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Waiting for evidence, 2 tasks" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scheduled, 3 tasks" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Closed, 4 tasks" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "View details for Rice nutrition CTR" }));
    expect(await screen.findByText("Review clicks, impressions, CTR, and query mix.")).toBeTruthy();
    expect(screen.getByText(/Evidence snapshot:/)).toBeTruthy();
    expect(await screen.findByText("No decision history yet.")).toBeTruthy();
    expect(authFetch).toHaveBeenCalledWith("/api/seo/tasks/task-1");
  });

  it("does not retain unverified counts when the workboard request fails", async () => {
    authFetch.mockReturnValueOnce(response({ error: "Task list unavailable" }, false));

    render(<SeoTasksPage />);

    expect((await screen.findByRole("alert")).textContent).toContain("Task list unavailable");
    expect(screen.getByRole("button", { name: "Ready now, 0 tasks" })).toBeTruthy();
  });

  it("creates a task through the inline form", async () => {
    render(<SeoTasksPage />);
    await screen.findByText("Rice nutrition CTR");
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Index coverage review");
    await userEvent.type(screen.getByRole("textbox", { name: "Description" }), "Review indexed coverage.");
    await userEvent.type(screen.getByLabelText("Earliest review"), "2026-08-01T09:00");
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith("/api/seo/tasks", expect.objectContaining({
      method: "POST",
    })));
  });

  it("requires an explicit confirmation and note before completion", async () => {
    render(<SeoTasksPage />);
    await screen.findByText("Rice nutrition CTR");
    await userEvent.click(screen.getByRole("button", { name: "View details for Rice nutrition CTR" }));
    await userEvent.click(await screen.findByRole("button", { name: "Complete task" }));

    const region = screen.getByRole("group", { name: "Complete Rice nutrition CTR" });
    const submit = within(region).getByRole("button", { name: "Confirm completion" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await userEvent.type(within(region).getByRole("textbox", { name: "Completion note" }), "CTR improved and the title is retained.");
    await userEvent.click(within(region).getByRole("checkbox", { name: "I confirm this evidence was reviewed" }));
    expect(submit.disabled).toBe(false);
    await userEvent.click(submit);

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(
      "/api/seo/tasks/task-1",
      expect.objectContaining({ method: "PATCH" }),
    ));
  });

  it("loads the workboard with one list request instead of a duplicate counts request", async () => {
    render(<SeoTasksPage />);
    await screen.findByText("Rice nutrition CTR");

    const listCalls = authFetch.mock.calls.filter(([url]) =>
      typeof url === "string" && url.startsWith("/api/seo/tasks?"));
    expect(listCalls).toHaveLength(1);
  });

  it("removes stale actionable rows when a newly selected bucket fails to load", async () => {
    authFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("bucket=waiting") && !init) {
        return response({ error: "Waiting tasks unavailable" }, false);
      }
      if (url.startsWith("/api/seo/tasks?") && !init) return response(list);
      throw new Error(`Unexpected request ${url}`);
    });

    render(<SeoTasksPage />);
    expect(await screen.findByText("Rice nutrition CTR")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Waiting for evidence, 2 tasks" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Waiting tasks unavailable");
    expect(screen.queryByText("Rice nutrition CTR")).toBeNull();
  });

  it("edits display fields without resubmitting or rewriting evidence", async () => {
    render(<SeoTasksPage />);
    await screen.findByText("Rice nutrition CTR");
    await userEvent.click(screen.getByRole("button", { name: "View details for Rice nutrition CTR" }));
    await userEvent.click(await screen.findByRole("button", { name: "Edit task" }));

    const title = screen.getByRole("textbox", { name: "Title" });
    await userEvent.clear(title);
    await userEvent.type(title, "Updated rice nutrition CTR");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const patch = authFetch.mock.calls.find(([url, init]) =>
        url === "/api/seo/tasks/task-1" && init?.method === "PATCH");
      expect(patch).toBeTruthy();
      const body = JSON.parse(String(patch?.[1]?.body)) as {
        fields: Record<string, unknown>;
      };
      expect(body.fields.title).toBe("Updated rice nutrition CTR");
      expect(body.fields).not.toHaveProperty("requiresEvidence");
      expect(body.fields).not.toHaveProperty("evidenceRequirement");
    });
  });
});

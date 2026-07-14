// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-auth-fetch", () => ({ useAuthFetch: () => authFetch, withShopifyContextUrl: (url: string) => url }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/client-cache", () => ({ getCache: () => null, setCache: vi.fn() }));
vi.mock("@shopify/polaris", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Button = ({ children, onClick, onAction, disabled, loading }: any) => <button onClick={onClick ?? onAction} disabled={disabled || loading}>{loading ? `${children} loading` : children}</button>;
  const Badge = ({ children }: any) => <span>{children}</span>;
  const Text = ({ children }: any) => <span>{children}</span>;
  const Banner = ({ children }: any) => <div role="alert">{children}</div>;
  const Toast = ({ content }: any) => <div role="status">{content}</div>;
  const Modal = ({ open, title, children, primaryAction, secondaryActions }: any) => open ? <div role="dialog" aria-label={title}>{children}<button onClick={primaryAction.onAction} disabled={primaryAction.disabled || primaryAction.loading}>{primaryAction.content}</button>{secondaryActions?.map((action: any) => <button key={action.content} onClick={action.onAction} disabled={action.disabled}>{action.content}</button>)}</div> : null;
  Modal.Section = passthrough;
  const Layout = Object.assign(passthrough, { Section: passthrough });
  const DataTable = ({ headings, rows }: any) => <table><thead><tr>{headings.map((heading: string) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row: any[], index: number) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>;
  const Tabs = ({ tabs, selected, onSelect }: any) => <div role="tablist">{tabs.map((tab: any, index: number) => <button key={tab.id} role="tab" aria-selected={selected === index} onClick={() => onSelect(index)}>{tab.content}</button>)}</div>;
  const TextField = ({ label, value, onChange, type }: any) => <label>{label}<input aria-label={label} type={type ?? "text"} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
  const Select = ({ label, value, options, onChange }: any) => <label>{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  const Collapsible = ({ open, children }: any) => open ? <div>{children}</div> : null;
  return { Page: passthrough, Layout, Card: passthrough, Text, Badge, InlineStack: passthrough, BlockStack: passthrough, Box: passthrough, Divider: () => <hr />, ProgressBar: passthrough, DataTable, Tabs, Button, Banner, Toast, Modal, TextField, Select, Collapsible };
});

import StorePilotReportPage from "@/app/(embedded)/(store-pilot)/store-pilot/page";
import { MapTaskDetails, type StoreTaskView } from "@/app/(embedded)/(store-pilot)/store-pilot/components/MapTaskDetails";

afterEach(cleanup);

const executable = {
  id: "map-1", createdAt: "2026-07-13T04:00:00.000Z", taskType: "topical_map", targetType: "product", targetId: null,
  targetUrl: "/products/black-rice", title: "Map SEO", description: "Review map SEO", priority: "high", status: "pending",
  completedAt: null, completionNote: null,
  sourceData: { source: "topical-map", executable: true, strategyVersionId: "strategy-v3", packageSha256: "a".repeat(64), ruleIds: ["seo:title"], observedAt: "2026-07-13T04:00:00.000Z" },
  proposedState: { action: "seo_update", before: { seoTitle: "Black Rice" }, after: { seoTitle: "Organic Black Rice" } },
};
const advisory = { ...executable, id: "map-2", title: "Map advisory", priority: "P0", sourceData: { ...executable.sourceData, executable: false, advisoryReason: "canonicalization_execution_prohibited", mapPriority: "P0", proposedCanonicalUrl: "/products/black-rice", mapDecision: "Use the product URL as canonical", mapEvidence: "The product owns commercial intent" }, proposedState: { action: "advisory", advisory: "canonicalization_execution_prohibited" } };
const ordinary = { ...executable, id: "ordinary-1", taskType: "price_review", title: "Ordinary task", sourceData: {}, proposedState: {} };
const groupedLinks = {
  ...executable,
  id: "map-links",
  targetUrl: "/collections/rice",
  sourceData: {
    ...executable.sourceData,
    action: "internal_link",
    links: [
      { anchor: "shop heirloom rice", toUrl: "/products/heirloom-rice" },
      { anchor: "compare rice varieties", toUrl: "/collections/rice-varieties" },
    ],
  },
  proposedState: {
    action: "internal_link",
    before: { bodyHtml: "<p>raw current HTML</p>" },
    after: { bodyHtml: "<p>raw proposed HTML</p>" },
  },
};

function response(body: unknown, ok = true) { return Promise.resolve({ ok, json: async () => body }); }
function deferredResponse() {
  let resolve!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
  const promise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((next) => { resolve = next; });
  return { promise, resolve };
}
function storeTaskResponse(url: string) {
  const params = new URL(url, "http://test.local").searchParams;
  const executionClass = params.get("executionClass");
  const status = params.get("status");
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  if (pageSize === 50 && executionClass === "actionable" && status === "pending") {
    return response({ tasks: [executable, ordinary], total: 704, page, pageSize: 50, hasMore: true });
  }
  if (pageSize === 50 && executionClass === "advisory" && status === "pending") {
    return response({ tasks: [advisory], total: 1, page, pageSize: 50, hasMore: false });
  }
  return response({ tasks: [], total: status === "pending" ? 1 : 0, page: 1, pageSize, hasMore: false });
}
function installFetch(applyResponse: { ok: boolean; error?: string } = { ok: true }, executeResponse: any = { runId: "run-1", status: "success", summary: { considered: 1, dryRun: false }, errors: [], task: { id: "map-1", status: "completed", completionNote: "Shopify update verified." } }) {
  authFetch.mockImplementation((url: string) => {
    if (url === "/api/images") return response({ images: [], total: 0, missingAltText: 0 });
    if (url.startsWith("/api/store-tasks?")) return storeTaskResponse(url);
    if (url === "/api/store-tasks/topical-map/sync") return response({ executable: 1 });
    if (url === "/api/store-tasks/map-1") return response({ task: executable });
    if (url === "/api/store-tasks/map-1/apply") return response(applyResponse.ok ? { taskId: "map-1", recommendationId: "rec-1", status: "queued" } : { error: applyResponse.error }, applyResponse.ok);
    if (url === "/api/store-tasks/map-1/execute") return response(executeResponse, executeResponse.ok !== false);
    if (url === "/api/store-tasks") return response({ task: ordinary });
    throw new Error(`Unexpected URL ${url}`);
  });
}
async function renderPage() {
  render(<StorePilotReportPage />);
  await screen.findByText("Ordinary task");
}

describe("Store Pilot topical-map workflow", () => {
  beforeEach(() => { authFetch.mockReset(); installFetch(); });

  it("shows actionable and advisory views with bounded search and pagination controls", async () => {
    await renderPage();
    expect(screen.getByRole("tab", { name: "Actionable" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Advisory" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search Store Tasks" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("queries the selected page and keeps advisory references dismiss-only", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(expect.stringContaining("executionClass=actionable&status=pending&page=2&pageSize=50")));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Store Tasks" }), "canonical");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(expect.stringContaining("executionClass=actionable&status=pending&page=1&pageSize=50&q=canonical")));

    await userEvent.click(screen.getByRole("tab", { name: "Advisory" }));
    await screen.findByText("Map advisory");
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("installs only the newest active-page response when requests resolve out of order", async () => {
    const olderActionable = deferredResponse();
    const newerAdvisory = deferredResponse();
    authFetch.mockImplementation((url: string) => {
      if (url === "/api/images") return response({ images: [], total: 0, missingAltText: 0 });
      if (url.startsWith("/api/store-tasks?")) {
        const params = new URL(url, "http://test.local").searchParams;
        if (params.get("pageSize") === "50") {
          return params.get("executionClass") === "actionable" ? olderActionable.promise : newerAdvisory.promise;
        }
        return response({ tasks: [], total: 0, page: 1, pageSize: 1, hasMore: false });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    render(<StorePilotReportPage />);
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(expect.stringContaining("executionClass=actionable&status=pending&page=1&pageSize=50")));
    await userEvent.click(screen.getByRole("tab", { name: "Advisory" }));
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(expect.stringContaining("executionClass=advisory&status=pending&page=1&pageSize=50")));

    await act(async () => newerAdvisory.resolve({ ok: true, json: async () => ({ tasks: [advisory], total: 1, page: 1, pageSize: 50, hasMore: false }) }));
    expect(await screen.findByText("Map advisory")).toBeTruthy();

    await act(async () => olderActionable.resolve({ ok: true, json: async () => ({ tasks: [executable, ordinary], total: 2, page: 1, pageSize: 50, hasMore: false }) }));
    expect(screen.getByText("Map advisory")).toBeTruthy();
    expect(screen.queryByText("Ordinary task")).toBeNull();
  });

  it("keeps a valid active page when summary counts fail", async () => {
    let failSummaries = false;
    authFetch.mockImplementation((url: string) => {
      if (url === "/api/images") return response({ images: [], total: 0, missingAltText: 0 });
      if (url.startsWith("/api/store-tasks?")) {
        const params = new URL(url, "http://test.local").searchParams;
        if (params.get("pageSize") === "50") return storeTaskResponse(url);
        if (failSummaries && params.get("executionClass") === "actionable" && params.get("status") === "pending") {
          return response({ error: "x".repeat(10_000) }, false);
        }
        return response({ tasks: [], total: 0, page: 1, pageSize: 1, hasMore: false });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await renderPage();
    failSummaries = true;
    await userEvent.click(screen.getByRole("tab", { name: "Advisory" }));

    expect(await screen.findByText("Map advisory")).toBeTruthy();
    expect(screen.queryByText("Ordinary task")).toBeNull();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("summary counts are temporarily unavailable");
    expect(alert.textContent!.length).toBeLessThan(200);
  });

  it("syncs once on rapid clicks, then reloads the selected page and summaries", async () => {
    await renderPage();
    const sync = screen.getByRole("button", { name: "Sync topical map" });
    fireEvent.click(sync); fireEvent.click(sync);
    await screen.findByText("Topical-map tasks synchronized.");
    expect(authFetch.mock.calls.filter(([url]) => url === "/api/store-tasks/topical-map/sync")).toHaveLength(1);
    expect(authFetch.mock.calls.filter(([url]) => String(url).startsWith("/api/store-tasks?"))).toHaveLength(18);
  });

  it("requires separate approval and exact-target execution confirmations", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    const dialog = screen.getByRole("dialog", { name: "Approve topical-map change" });
    expect(authFetch.mock.calls.some(([url]) => url === "/api/store-tasks/map-1/apply")).toBe(false);
    expect(within(dialog).getByText("/products/black-rice")).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Approve and queue" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    const executeDialog = await screen.findByRole("dialog", { name: "Execute approved topical-map change" });
    expect(authFetch.mock.calls.filter(([url]) => url === "/api/store-tasks/map-1/apply")).toHaveLength(1);
    expect(authFetch.mock.calls.some(([url]) => url === "/api/store-tasks/map-1/execute")).toBe(false);
    expect(within(executeDialog).getByText(/execution is limited to this target/i)).toBeTruthy();
    fireEvent.click(within(executeDialog).getByRole("button", { name: "Execute approved change" }));
    await screen.findByText("The approved topical-map change was executed and verified.");
    expect(authFetch.mock.calls.filter(([url]) => url === "/api/store-tasks/map-1/execute")).toHaveLength(1);
    expect(authFetch.mock.calls.filter(([url]) => String(url).startsWith("/api/store-tasks?"))).toHaveLength(18);
  });

  it("explains a live-gate dry run without claiming Shopify changed", async () => {
    authFetch.mockReset();
    installFetch({ ok: true }, { runId: "run-1", status: "success", summary: { considered: 1, dryRun: true, simulated: 1 }, errors: [], task: { id: "map-1", status: "pending", completionNote: "Approved and queued for guarded execution." } });
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve and queue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Execute approved change" }));
    expect(await screen.findByText("The live execution gate is disabled; the approved recommendation remains queued and Shopify was not changed.")).toBeTruthy();
  });

  it("explains superseded work and keeps sync available", async () => {
    authFetch.mockReset();
    installFetch({ ok: true }, { runId: "run-1", status: "success", summary: { considered: 1, dryRun: false, superseded: 1 }, errors: [], task: { id: "map-1", status: "dismissed", completionNote: "Superseded (STRATEGY_CHANGED). Sync topical map to create current work." } });
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve and queue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Execute approved change" }));
    expect(await screen.findByText("This task was superseded because the strategy or store state changed. Sync topical map to create current work.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sync topical map" })).toBeTruthy();
  });

  it.each([
    [403, "Live store task execution is disabled."],
    [409, "The active strategy has changed."],
    [502, "Shopify could not verify the requested update."],
  ])("keeps %s apply errors visible", async (_status, message) => {
    authFetch.mockReset(); installFetch({ ok: false, error: message });
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve and queue" }));
    expect((await screen.findByRole("alert")).textContent).toContain(message);
  });

  it("preserves ordinary Complete and Dismiss mutations", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Complete" }));
    expect(authFetch).toHaveBeenCalledWith("/api/store-tasks", expect.objectContaining({ body: JSON.stringify({ id: "ordinary-1", status: "completed" }) }));
    await userEvent.click(screen.getAllByRole("button", { name: "Dismiss" }).at(-1)!);
    expect(authFetch).toHaveBeenCalledWith("/api/store-tasks", expect.objectContaining({ body: JSON.stringify({ id: "ordinary-1", status: "dismissed" }) }));
  });

  it("disables every mutation control while a mutation is active", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    authFetch.mockImplementation((url: string) => {
      if (url === "/api/store-tasks/topical-map/sync") return pending.then(() => ({ ok: true, json: async () => ({}) }));
      if (url === "/api/images") return response({ images: [], total: 0, missingAltText: 0 });
      if (url === "/api/store-tasks/map-1") return response({ task: executable });
      if (url.startsWith("/api/store-tasks?")) return storeTaskResponse(url);
      return response({ tasks: [], total: 0, page: 1, pageSize: 50, hasMore: false });
    });
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Sync topical map" }));
    await waitFor(() => expect((screen.getByRole("button", { name: /Sync topical map/ }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Complete" }) as HTMLButtonElement).disabled).toBe(true);
    screen.getAllByRole("button", { name: "Dismiss" }).forEach((button) => expect((button as HTMLButtonElement).disabled).toBe(true));
    release();
  });

  it("disables an already-open modal confirmation while another mutation is active", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    authFetch.mockImplementation((url: string) => {
      if (url === "/api/store-tasks/topical-map/sync") return pending.then(() => ({ ok: true, json: async () => ({}) }));
      if (url === "/api/images") return response({ images: [], total: 0, missingAltText: 0 });
      if (url === "/api/store-tasks/map-1") return response({ task: executable });
      if (url.startsWith("/api/store-tasks?")) return storeTaskResponse(url);
      return response({ tasks: [], total: 0, page: 1, pageSize: 50, hasMore: false });
    });
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Sync topical map" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Approve and queue" }) as HTMLButtonElement).disabled).toBe(true));
    release();
  });
});

describe("MapTaskDetails disclosure", () => {
  it("shows the exact redirect source and proposed target", () => {
    render(<MapTaskDetails task={{
      ...executable,
      id: "redirect-1",
      targetUrl: "/old-rice",
      sourceData: { ...executable.sourceData, targetType: "redirect", action: "redirect_create", redirectTarget: "/products/rice" },
      proposedState: { action: "redirect_create", before: { state: "absent" }, after: { target: "/products/rice" } },
    } as StoreTaskView} />);
    expect(screen.getByText("Redirect source")).toBeTruthy();
    expect(screen.getByText("/old-rice")).toBeTruthy();
    expect(screen.getByText("Proposed target")).toBeTruthy();
    expect(screen.getByText("/products/rice")).toBeTruthy();
  });
  it("labels identity and omits a duplicate unlabelled target", () => {
    render(<MapTaskDetails task={executable as StoreTaskView} />);
    expect(screen.getByText("Strategy version:")).toBeTruthy();
    expect(screen.getByText("Package:")).toBeTruthy();
    expect(screen.getAllByText("/products/black-rice")).toHaveLength(1);
  });

  it("shows bounded canonicalization and indexation advisory instructions", () => {
    render(<MapTaskDetails task={advisory as StoreTaskView} />);
    expect(screen.getByText("Original priority:")).toBeTruthy();
    expect(screen.getByText("P0")).toBeTruthy();
    expect(screen.getByText("Proposed canonical URL:")).toBeTruthy();
    expect(screen.getByText("Use the product URL as canonical")).toBeTruthy();
    expect(screen.getByText("The product owns commercial intent")).toBeTruthy();
  });

  it("bounds long values until the standard disclosure is activated", async () => {
    const longValue = `start-${"x".repeat(50_000)}-finish`;
    const task = { ...executable, proposedState: { action: "content_update", before: { bodyHtml: longValue }, after: { bodyHtml: `${longValue}-new` } } } as StoreTaskView;
    render(<MapTaskDetails task={task} />);
    expect(screen.queryByText(longValue)).toBeNull();
    screen.getAllByText(/start-x+/).forEach((preview) => expect(preview.textContent!.length).toBeLessThan(1000));
    await userEvent.click(screen.getByRole("button", { name: "Show full current value" }));
    expect(screen.getByText(longValue)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show full proposed value" }));
    expect(screen.getByText(`${longValue}-new`)).toBeTruthy();
  });

  it("reviews grouped internal links semantically before raw HTML", async () => {
    render(<MapTaskDetails task={groupedLinks as StoreTaskView} />);
    expect(screen.getByText("Links to add (2)")).toBeTruthy();
    expect(screen.getByText("shop heirloom rice")).toBeTruthy();
    expect(screen.getByText("/products/heirloom-rice")).toBeTruthy();
    expect(screen.getByText("compare rice varieties")).toBeTruthy();
    expect(screen.getByText("/collections/rice-varieties")).toBeTruthy();
    expect(screen.queryByText("<p>raw current HTML</p>")).toBeNull();
    expect(screen.queryByText("<p>raw proposed HTML</p>")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show raw HTML diagnostic" }));
    expect(screen.getByText("<p>raw current HTML</p>")).toBeTruthy();
    expect(screen.getByText("<p>raw proposed HTML</p>")).toBeTruthy();
  });
});

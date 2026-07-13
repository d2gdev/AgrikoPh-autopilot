// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  const Tabs = () => null;
  return { Page: passthrough, Layout, Card: passthrough, Text, Badge, InlineStack: passthrough, BlockStack: passthrough, Box: passthrough, Divider: () => <hr />, ProgressBar: passthrough, DataTable, Tabs, Button, Banner, Toast, Modal };
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
const advisory = { ...executable, id: "map-2", title: "Map advisory", sourceData: { ...executable.sourceData, executable: false, advisoryReason: "canonicalization_execution_prohibited" }, proposedState: { action: "advisory", advisory: "canonicalization_execution_prohibited" } };
const ordinary = { ...executable, id: "ordinary-1", taskType: "price_review", title: "Ordinary task", sourceData: {}, proposedState: {} };

function response(body: unknown, ok = true) { return Promise.resolve({ ok, json: async () => body }); }
function installFetch(applyResponse: { ok: boolean; error?: string } = { ok: true }) {
  authFetch.mockImplementation((url: string) => {
    if (url === "/api/images") return response({ images: [], total: 0, missingAltText: 0 });
    if (url.startsWith("/api/store-tasks?status=pending")) return response({ tasks: [executable, advisory, ordinary], total: 3 });
    if (url.startsWith("/api/store-tasks?status=")) return response({ tasks: [], total: 0 });
    if (url === "/api/store-tasks/topical-map/sync") return response({ executable: 1 });
    if (url === "/api/store-tasks/map-1") return response({ task: executable });
    if (url === "/api/store-tasks/map-1/apply") return response(applyResponse.ok ? { task: executable } : { error: applyResponse.error }, applyResponse.ok);
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

  it("syncs once on rapid clicks, then reloads every bucket and shows success", async () => {
    await renderPage();
    const sync = screen.getByRole("button", { name: "Sync topical map" });
    fireEvent.click(sync); fireEvent.click(sync);
    await screen.findByText("Topical-map tasks synchronized.");
    expect(authFetch.mock.calls.filter(([url]) => url === "/api/store-tasks/topical-map/sync")).toHaveLength(1);
    expect(authFetch.mock.calls.filter(([url]) => String(url).startsWith("/api/store-tasks?status="))).toHaveLength(8);
  });

  it("opens Apply confirmation and calls apply only after confirmation", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    const dialog = screen.getByRole("dialog", { name: "Approve topical-map change" });
    expect(authFetch.mock.calls.some(([url]) => url === "/api/store-tasks/map-1/apply")).toBe(false);
    expect(within(dialog).getByText("/products/black-rice")).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Approve and queue" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    await screen.findByText("The topical-map change was approved and queued.");
    expect(authFetch.mock.calls.filter(([url]) => url === "/api/store-tasks/map-1/apply")).toHaveLength(1);
    expect(authFetch.mock.calls.filter(([url]) => String(url).startsWith("/api/store-tasks?status="))).toHaveLength(8);
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
      if (url.startsWith("/api/store-tasks?status=pending")) return response({ tasks: [executable, advisory, ordinary], total: 3 });
      return response({ tasks: [], total: 0 });
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
      if (url.startsWith("/api/store-tasks?status=pending")) return response({ tasks: [executable, advisory, ordinary], total: 3 });
      return response({ tasks: [], total: 0 });
    });
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Sync topical map" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Approve and queue" }) as HTMLButtonElement).disabled).toBe(true));
    release();
  });
});

describe("MapTaskDetails disclosure", () => {
  it("labels identity and omits a duplicate unlabelled target", () => {
    render(<MapTaskDetails task={executable as StoreTaskView} />);
    expect(screen.getByText("Strategy version:")).toBeTruthy();
    expect(screen.getByText("Package:")).toBeTruthy();
    expect(screen.getAllByText("/products/black-rice")).toHaveLength(1);
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
});

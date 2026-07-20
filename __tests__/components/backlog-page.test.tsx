// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const authFetch = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-auth-fetch", () => ({
  useAuthFetch: () => authFetch,
}));
vi.mock("@shopify/polaris", () => {
  const passthrough = (
    { children }: { children?: React.ReactNode },
  ) => <div>{children}</div>;
  const Page = ({ title, subtitle, primaryAction, children }: any) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <button onClick={primaryAction.onAction}>
        {primaryAction.content}
      </button>
      {children}
    </main>
  );
  const Button = ({
    children,
    onClick,
    disabled,
    loading,
    accessibilityLabel,
  }: any) => (
    <button
      aria-label={accessibilityLabel}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {children}
    </button>
  );
  const TextField = ({
    label,
    value,
    onChange,
    multiline,
    type,
  }: any) => (
    <label>
      {label}
      {multiline
        ? <textarea
            aria-label={label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        : <input
            aria-label={label}
            type={type ?? "text"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />}
    </label>
  );
  const Text = ({ children }: any) => <span>{children}</span>;
  const Banner = ({ children }: any) => (
    <div role="alert">{children}</div>
  );
  const Badge = ({ children }: any) => <span>{children}</span>;
  return {
    Page,
    Layout: Object.assign(passthrough, { Section: passthrough }),
    Card: passthrough,
    BlockStack: passthrough,
    InlineStack: passthrough,
    Text,
    Banner,
    Badge,
    Button,
    TextField,
    Divider: () => <hr />,
    SkeletonBodyText: () => <div>Loading backlog</div>,
  };
});

import BacklogPage from "@/app/(embedded)/backlog/page";

afterEach(cleanup);

const item = {
  id: "backlog-1",
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
  version: 1,
  title: "Recheck Shopify canonical cache",
  description: "Verify the normal article URL renders the corrected shell.",
  dueAt: "2026-07-22T15:59:59.999Z",
  status: "open",
  createdBy: "operator-1",
  updatedBy: "operator-1",
  completedAt: null,
  overdue: false,
};

function response(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body });
}

describe("Backlog page", () => {
  beforeEach(() => {
    authFetch.mockReset();
    authFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/backlog?status=open" && !init) {
        return response({
          items: [item],
          counts: { open: 1, completed: 0 },
          asOf: "2026-07-20T00:00:00.000Z",
        });
      }
      if (url === "/api/backlog" && init?.method === "POST") {
        return response({ item: { ...item, id: "backlog-2" } });
      }
      if (url === "/api/backlog/backlog-1"
          && init?.method === "PATCH") {
        return response({
          item: { ...item, version: 2, status: "completed" },
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
  });

  it("shows due-dated open work and truthful counts", async () => {
    render(<BacklogPage />);

    expect(screen.getByText("Loading backlog")).toBeTruthy();
    expect(await screen.findByText(item.title)).toBeTruthy();
    expect(screen.getByText(item.description)).toBeTruthy();
    expect(screen.getByText("Due Jul 22, 2026")).toBeTruthy();
    expect(screen.getByRole("button", {
      name: "Open backlog, 1 item",
    })).toBeTruthy();
    expect(screen.getByRole("button", {
      name: "Completed backlog, 0 items",
    })).toBeTruthy();
  });

  it("requires a due date and creates through the shared API", async () => {
    render(<BacklogPage />);
    await screen.findByText(item.title);
    await userEvent.click(screen.getByRole("button", {
      name: "Add backlog item",
    }));
    await userEvent.type(screen.getByRole("textbox", {
      name: "Title",
    }), "Check indexing");
    await userEvent.type(screen.getByRole("textbox", {
      name: "Description",
    }), "Inspect the URL again.");

    const create = screen.getByRole("button", {
      name: "Create item",
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText("Due date"), "2026-07-22");
    await userEvent.click(create);

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(
      "/api/backlog",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "Check indexing",
          description: "Inspect the URL again.",
          dueAt: "2026-07-22T15:59:59.999Z",
        }),
      }),
    ));
  });

  it("completes an item without hiding the persisted result", async () => {
    render(<BacklogPage />);
    await screen.findByText(item.title);

    await userEvent.click(screen.getByRole("button", {
      name: `Complete ${item.title}`,
    }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(
      "/api/backlog/backlog-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          action: "complete",
          expectedVersion: 1,
        }),
      }),
    ));
  });
});

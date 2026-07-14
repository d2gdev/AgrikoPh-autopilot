import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/ai/client", () => ({
  getAiClient: vi.fn().mockResolvedValue({ provider: "test", model: "test", client: { chat: { completions: { create: ai.create } } } }),
}));
vi.mock("@/lib/content-pilot/brand-guidelines", () => ({ getBrandGuidelines: vi.fn().mockResolvedValue("") }));
vi.mock("@/lib/ai/knowledge", () => ({ retrieveContext: vi.fn().mockResolvedValue([]), formatGroundingBlock: vi.fn().mockReturnValue("") }));

import { generateDraft } from "@/lib/content-pilot/generate-draft";

describe("topical-map new-content title generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEEPSEEK_API_KEY", "test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when the model replaces the persisted map title", async () => {
    ai.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ title: "AI-invented replacement title", bodyHtml: "<p>Draft</p>", tags: ["rice"], metaDescription: "Draft description" }) }, finish_reason: "stop" }],
    });
    const proposal = {
      proposalType: "new-content",
      title: "The Exact Active Map Title",
      articleHandle: "map-title",
      proposedState: { title: "The Exact Active Map Title", targetKeyword: "black rice guide" },
    };

    await expect(generateDraft(proposal as never, null)).rejects.toThrow("exact persisted map title");
    expect(ai.create).toHaveBeenCalledTimes(2);
    const userPrompt = ai.create.mock.calls[0]![0].messages[1].content;
    expect(userPrompt).toContain("The Exact Active Map Title");
  });

  it("uses persisted map secondary variants when drafting new content", async () => {
    ai.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ title: "The Exact Active Map Title", bodyHtml: "<p>Draft</p>", tags: ["rice"], metaDescription: "Draft description" }) }, finish_reason: "stop" }],
    });
    const proposal = {
      proposalType: "new-content",
      title: "The Exact Active Map Title",
      articleHandle: "map-title",
      proposedState: { title: "The Exact Active Map Title", targetKeyword: "black rice guide" },
      sourceData: { secondaryVariants: "black rice benefits; organic black rice Philippines" },
    };

    await expect(generateDraft(proposal as never, null)).resolves.toMatchObject({ title: "The Exact Active Map Title" });
    const prompts = ai.create.mock.calls[0]![0].messages.map((message: { content: string }) => message.content).join("\n");
    expect(prompts).toContain("black rice benefits");
    expect(prompts).toContain("organic black rice Philippines");
  });

  it("uses persisted map secondary variants when drafting a content refresh", async () => {
    ai.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ bodyHtml: "<p>Refreshed draft</p>" }) }, finish_reason: "stop" }] });
    const proposal = {
      proposalType: "content-refresh",
      title: "Refresh the map page",
      articleHandle: "map-page",
      description: "Refresh according to the active map.",
      proposedState: { action: "refresh", targetKeyword: "black rice guide" },
      sourceData: { secondaryVariants: "black rice benefits; organic black rice Philippines" },
    };
    const article = { title: "Current title", bodyHtml: "<p>Current body</p>" };

    await expect(generateDraft(proposal as never, article as never)).resolves.toMatchObject({ bodyHtml: "<p>Refreshed draft</p>" });
    const prompts = ai.create.mock.calls[0]![0].messages.map((message: { content: string }) => message.content).join("\n");
    expect(prompts).toContain("black rice benefits");
    expect(prompts).toContain("organic black rice Philippines");
  });
});

import { beforeEach, expect, test, vi } from "vitest";
import { embedTexts, EmbeddingsUnavailableError, EMBEDDING_DIM } from "@/lib/ai/embeddings";

const createMock = vi.fn();
vi.mock("openai", () => ({
  __esModule: true,
  default: class { embeddings = { create: (...a: unknown[]) => createMock(...a) }; },
}));

const secrets: Record<string, string | null> = {};
vi.mock("@/lib/config/resolver", () => ({
  getOptionalSecret: (k: string) => Promise.resolve(secrets[k] ?? null),
}));

beforeEach(() => {
  createMock.mockReset();
  secrets.EMBEDDINGS_BASE_URL = "http://odysseus:11434/v1";
  secrets.EMBEDDINGS_MODEL = null;
});

test("returns one vector per input in order", async () => {
  createMock.mockResolvedValue({
    data: [
      { index: 0, embedding: Array(EMBEDDING_DIM).fill(0.1) },
      { index: 1, embedding: Array(EMBEDDING_DIM).fill(0.2) },
    ],
  });
  const out = await embedTexts(["a", "b"]);
  expect(out).toHaveLength(2);
  expect(out[0]).toHaveLength(EMBEDDING_DIM);
  expect(out[1]![0]).toBeCloseTo(0.2);
});

test("reorders by returned index", async () => {
  createMock.mockResolvedValue({
    data: [
      { index: 1, embedding: Array(EMBEDDING_DIM).fill(0.2) },
      { index: 0, embedding: Array(EMBEDDING_DIM).fill(0.1) },
    ],
  });
  const out = await embedTexts(["a", "b"]);
  expect(out[0]![0]).toBeCloseTo(0.1);
  expect(out[1]![0]).toBeCloseTo(0.2);
});

test("throws EmbeddingsUnavailableError when base url unset", async () => {
  secrets.EMBEDDINGS_BASE_URL = null;
  await expect(embedTexts(["a"])).rejects.toBeInstanceOf(EmbeddingsUnavailableError);
});

test("empty input returns empty without calling the API", async () => {
  expect(await embedTexts([])).toEqual([]);
  expect(createMock).not.toHaveBeenCalled();
});

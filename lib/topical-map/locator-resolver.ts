import { createHash } from "node:crypto";
import { z } from "zod";
import { SourceLocatorError, type SemanticSourceArtifactId } from "./types";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const headingPath = z.array(z.string().min(1)).min(1);
const markdownLocator = z.object({ kind: z.enum(["markdown_heading", "markdown_prose_span"]), headingPath, contentFingerprint: sha256, lineStart: z.number().int().min(1), lineEnd: z.number().int().min(1) }).strict();
const csvLocator = z.object({ kind: z.literal("csv_row"), businessKey: z.string().min(1), headerFingerprint: sha256, rowFingerprint: sha256, rowNumber: z.number().int().min(2) }).strict();
const locatorSchema = z.union([markdownLocator, csvLocator]);

type SourceLocator = z.infer<typeof locatorSchema>;
type ResolvedSourceLocator = { artifactId: SemanticSourceArtifactId; lineStart: number; lineEnd: number };
const markdownArtifacts = new Set<SemanticSourceArtifactId>(["map", "evidence"]);
const csvArtifacts = new Set<SemanticSourceArtifactId>(["url-inventory", "redirect-inventory", "internal-links"]);

const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeText = (value: string) => value.normalize("NFC").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).join("\n").trim();

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) { if (char === '"' && text[index + 1] === '"') { field += char; index += 1; } else if (char === '"') quoted = false; else field += char; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n" || char === "\r") { if (char === "\r" && text[index + 1] === "\n") index += 1; row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += char;
  }
  if (quoted) throw new SourceLocatorError("INVALID_SOURCE_LOCATOR");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const normalizeCell = (value: string) => value.normalize("NFC").trim();
const canonicalRow = (headers: string[], values: string[]) => JSON.stringify(headers.map((header, index) => [header, normalizeCell(values[index] ?? "")]));

function resolveCsv(artifactId: SemanticSourceArtifactId, bytes: Buffer, locator: Extract<SourceLocator, { kind: "csv_row" }>): ResolvedSourceLocator {
  const rows = parseCsv(bytes.toString("utf8"));
  let leadingBlankRows = 0;
  while (rows[0]?.every((value) => normalizeCell(value) === "")) { rows.shift(); leadingBlankRows += 1; }
  const headers = rows.shift();
  if (!headers || !headers.length || new Set(headers).size !== headers.length) throw new SourceLocatorError("INVALID_SOURCE_LOCATOR");
  const normalizedHeaders = headers.map(normalizeCell);
  if (fingerprint(JSON.stringify(normalizedHeaders)) !== locator.headerFingerprint) throw new SourceLocatorError("LOCATOR_FINGERPRINT_DRIFT");
  const key = artifactId === "url-inventory" ? (values: string[]) => normalizeCell(values[normalizedHeaders.indexOf("current_url")] ?? "") : artifactId === "redirect-inventory" ? (values: string[]) => normalizeCell(values[normalizedHeaders.indexOf("redirect_id")] ?? "") : (values: string[]) => `${normalizeCell(values[normalizedHeaders.indexOf("from_url")] ?? "")}\u001f${normalizeCell(values[normalizedHeaders.indexOf("to_url")] ?? "")}`;
  const candidates = rows.map((values, index) => ({ values, line: index + 2 + leadingBlankRows })).filter(({ values }) => key(values) === locator.businessKey);
  if (!candidates.length) throw new SourceLocatorError("LOCATOR_MISSING");
  const matched = candidates.filter(({ values }) => fingerprint(canonicalRow(normalizedHeaders, values)) === locator.rowFingerprint);
  if (!matched.length) throw new SourceLocatorError("LOCATOR_FINGERPRINT_DRIFT");
  if (matched.length !== 1 || candidates.length !== 1) throw new SourceLocatorError("LOCATOR_AMBIGUOUS");
  return { artifactId, lineStart: matched[0]!.line, lineEnd: matched[0]!.line };
}

const markdownIndexCache = new WeakMap<Buffer, { lines: string[]; headings: Array<{ path: string[]; start: number; end: number }> }>();
const markdownResolutionCache = new WeakMap<Buffer, Map<string, Array<{ start: number; end: number }>>>();
function markdownIndex(bytes: Buffer): { lines: string[]; headings: Array<{ path: string[]; start: number; end: number }> } {
  const cached = markdownIndexCache.get(bytes); if (cached) return cached;
  const lines = bytes.toString("utf8").replace(/\r\n?/g, "\n").split("\n");
  const paths: Array<{ path: string[]; start: number; end: number; depth: number }> = []; const stack: Array<{ depth: number; text: string }> = [];
  for (let index = 0; index < lines.length; index += 1) { const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index]!); if (!match) continue; const depth = match[1]!.length; while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop(); stack.push({ depth, text: match[2]!.trim() }); paths.push({ path: stack.map((part) => part.text), start: index, end: lines.length - 1, depth }); }
  for (let index = 0; index < paths.length; index += 1) { const next = paths.slice(index + 1).find((entry) => entry.depth <= paths[index]!.depth); paths[index]!.end = next ? next.start - 1 : lines.length - 1; }
  const indexed = { lines, headings: paths };
  markdownIndexCache.set(bytes, indexed); return indexed;
}

function resolveMarkdown(artifactId: SemanticSourceArtifactId, bytes: Buffer, locator: Exclude<SourceLocator, { kind: "csv_row" }>): ResolvedSourceLocator {
  const cacheKey = `${locator.kind}\u0000${JSON.stringify(locator.headingPath)}\u0000${locator.contentFingerprint}`;
  const resolutions = markdownResolutionCache.get(bytes) ?? new Map<string, Array<{ start: number; end: number }>>();
  markdownResolutionCache.set(bytes, resolutions);
  const cached = resolutions.get(cacheKey);
  if (cached) { if (cached.length !== 1) throw new SourceLocatorError("LOCATOR_AMBIGUOUS"); return { artifactId, lineStart: cached[0]!.start + 1, lineEnd: cached[0]!.end + 1 }; }
  const { lines, headings } = markdownIndex(bytes);
  const candidates: Array<{ start: number; end: number }> = [];
  for (const heading of headings.filter((entry) => JSON.stringify(entry.path) === JSON.stringify(locator.headingPath))) {
    if (locator.kind === "markdown_heading") { if (fingerprint(normalizeText(lines.slice(heading.start, heading.end + 1).join("\n"))) === locator.contentFingerprint) candidates.push({ start: heading.start, end: heading.end }); continue; }
    const spanLength = locator.lineEnd - locator.lineStart + 1;
    let matchedExpectedLength = false;
    for (let start = heading.start; start + spanLength - 1 <= heading.end; start += 1) { let end = start + spanLength - 1; if (fingerprint(normalizeText(lines.slice(start, end + 1).join("\n"))) !== locator.contentFingerprint) continue; matchedExpectedLength = true; while (start <= end && lines[start]!.trim() === "") start += 1; while (end >= start && lines[end]!.trim() === "") end -= 1; if (!candidates.some((candidate) => candidate.start === start && candidate.end === end)) candidates.push({ start, end }); }
    if (matchedExpectedLength) continue;
    for (let start = heading.start; start <= heading.end; start += 1) for (let end = start; end <= heading.end; end += 1) { if (fingerprint(normalizeText(lines.slice(start, end + 1).join("\n"))) !== locator.contentFingerprint) continue; let normalizedStart = start; let normalizedEnd = end; while (normalizedStart <= normalizedEnd && lines[normalizedStart]!.trim() === "") normalizedStart += 1; while (normalizedEnd >= normalizedStart && lines[normalizedEnd]!.trim() === "") normalizedEnd -= 1; if (!candidates.some((candidate) => candidate.start === normalizedStart && candidate.end === normalizedEnd)) candidates.push({ start: normalizedStart, end: normalizedEnd }); }
  }
  resolutions.set(cacheKey, candidates);
  if (!candidates.length) throw new SourceLocatorError("LOCATOR_FINGERPRINT_DRIFT");
  if (candidates.length !== 1) throw new SourceLocatorError("LOCATOR_AMBIGUOUS");
  return { artifactId, lineStart: candidates[0]!.start + 1, lineEnd: candidates[0]!.end + 1 };
}

export function resolveSourceLocator(input: { artifactId: SemanticSourceArtifactId; bytes: Buffer; locator: unknown }): ResolvedSourceLocator {
  const result = locatorSchema.safeParse(input.locator);
  if (!result.success) throw new SourceLocatorError("INVALID_SOURCE_LOCATOR");
  const locator = result.data;
  if (locator.kind === "csv_row") { if (!csvArtifacts.has(input.artifactId)) throw new SourceLocatorError("LOCATOR_CROSS_ARTIFACT"); return resolveCsv(input.artifactId, input.bytes, locator); }
  if (!markdownArtifacts.has(input.artifactId)) throw new SourceLocatorError("LOCATOR_CROSS_ARTIFACT");
  return resolveMarkdown(input.artifactId, input.bytes, locator);
}

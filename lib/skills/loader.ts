import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";

export type ExtraSource = "gsc" | "ga4" | "market_intel" | "keyword_research";

const VALID_EXTRA_SOURCES: ExtraSource[] = ["gsc", "ga4", "market_intel", "keyword_research"];

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  platform: "meta" | "both" | "seo" | "linkedin" | "reddit";
  pilotGroup: string;
  enabled: boolean;
  fullPrompt: string;
  insightBlock?: string; // e.g. "fatigue-report" | "search-term-opportunities" | "competitor-analysis"
  extraSources?: ExtraSource[]; // additional data sources to inject into the skill's payload
}

const SKILLS_DIR = path.join(process.cwd(), "skills-source");

let _cache: SkillDefinition[] | null = null;

type SkillFrontmatter = {
  name?: string;
  description?: string;
  enabled?: boolean;
  metadata?: {
    platform?: string;
    insightBlock?: string;
    extraSources?: string[];
  };
};

function parseExtraSources(raw: unknown): ExtraSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: ExtraSource[] = [];
  for (const value of raw) {
    if (typeof value === "string" && (VALID_EXTRA_SOURCES as string[]).includes(value)) {
      result.push(value as ExtraSource);
    } else {
      console.warn(`[skills/loader] Unknown extraSources value ignored: ${String(value)}`);
    }
  }
  return result.length > 0 ? result : undefined;
}

function parseFrontmatter(raw: string): { data: SkillFrontmatter; content: string } {
  if (!raw.startsWith("---\n")) return { data: {}, content: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { data: {}, content: raw };

  const frontmatter = raw.slice(4, end);
  const contentStart = raw.startsWith("\n", end + 4) ? end + 5 : end + 4;
  const parsed = yaml.load(frontmatter);
  const data = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as SkillFrontmatter
    : {};
  return { data, content: raw.slice(contentStart) };
}

function collectSkillFiles(): { filePath: string; pilotGroup: string }[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const results: { filePath: string; pilotGroup: string }[] = [];
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(SKILLS_DIR, entry.name);
    if (entry.isDirectory()) {
      for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
        if (sub.isFile() && sub.name.endsWith(".md")) {
          results.push({ filePath: path.join(full, sub.name), pilotGroup: entry.name });
        }
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push({ filePath: full, pilotGroup: "root" });
    }
  }
  return results;
}

function parseSkillFile(filePath: string, pilotGroup: string): SkillDefinition | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(raw);
    const fileName = path.basename(filePath, ".md");
    return {
      id: fileName,
      name: data.name ?? fileName,
      description: data.description ?? "",
      platform: mapPlatform((data.metadata?.platform ?? "both") as string),
      pilotGroup,
      enabled: data.enabled !== false,
      fullPrompt: content.trim(),
      insightBlock: (data.metadata?.insightBlock as string | undefined) ?? undefined,
      extraSources: parseExtraSources(data.metadata?.extraSources),
    };
  } catch (err) {
    console.warn(`[skills/loader] Failed to parse ${filePath}:`, err);
    return null;
  }
}

function mapPlatform(raw: string): SkillDefinition["platform"] {
  const lower = raw.toLowerCase();
  if (lower.includes("google") && lower.includes("meta")) return "both";
  if (lower.includes("meta")) return "meta";
  // seo/linkedin/reddit skills are parsed but not dispatched by run-skills — log at load time
  if (lower.includes("seo")) { console.warn(`[skills] Platform "seo" is not dispatched by run-skills`); return "seo"; }
  if (lower.includes("linkedin")) { console.warn(`[skills] Platform "linkedin" is not dispatched by run-skills`); return "linkedin"; }
  if (lower.includes("reddit")) { console.warn(`[skills] Platform "reddit" is not dispatched by run-skills`); return "reddit"; }
  if (lower.includes("google")) { console.warn(`[skills] Platform "Google" (Ads) is no longer supported — treating "${raw}" as "seo"; relabel this skill's frontmatter`); return "seo"; }
  return "both";
}

export function loadAllSkillsSync(): SkillDefinition[] {
  // Skip cache in dev so skill file edits take effect without a restart
  if (_cache && process.env.NODE_ENV === "production") return _cache;
  const files = collectSkillFiles();
  const seen = new Set<string>();
  const skills: SkillDefinition[] = [];
  // Root files first so canonical versions win dedup over subdirectory copies
  const sorted = [
    ...files.filter((f) => f.pilotGroup === "root"),
    ...files.filter((f) => f.pilotGroup !== "root"),
  ];
  for (const { filePath, pilotGroup } of sorted) {
    const fileName = path.basename(filePath);
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    const skill = parseSkillFile(filePath, pilotGroup);
    if (skill) skills.push(skill);
  }
  _cache = skills;
  return skills;
}

export async function loadAllSkills(): Promise<SkillDefinition[]> {
  return loadAllSkillsSync();
}

export async function loadSkill(skillId: string): Promise<SkillDefinition | null> {
  const all = loadAllSkillsSync();
  return all.find((s) => s.id === skillId) ?? null;
}

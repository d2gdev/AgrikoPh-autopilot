import { z } from "zod";
import type { SkillDefinition } from "./loader";
import type { RawSnapshot } from "@prisma/client";
import { getAiClient } from "@/lib/ai/client";
import { retrieveContext, formatGroundingBlock } from "@/lib/ai/knowledge";

// deepseek-v4-flash returns HTTP 200 with EMPTY content — it silently breaks
// skill JSON parsing and produces zero recommendations. deepseek-chat returns
// real content. See lib/ai/client.ts for the same fix.
const DEFAULT_MODEL = "deepseek-chat";


const RecommendationSchema = z.object({
  actionType: z.string(),
  targetEntityType: z.string(),
  targetEntityId: z.string(),
  targetEntityName: z.string(),
  currentValue: z.string().nullable().optional(),
  proposedValue: z.string().nullable().optional(),
  changePercent: z.number().nullable().optional(),
  rationale: z.string(),
  estimatedImpact: z.string().nullable().optional(),
  confidenceScore: z.number().min(0).max(1),
});

export type ParsedRecommendation = z.infer<typeof RecommendationSchema>;

const AGRIKO_CONTEXT = `
You are analyzing advertising data for Agriko (agrikoph.com), a Philippine health food brand.
Store currency: PHP (₱). Industry: health/wellness e-commerce. Location: Philippines.

CRITICAL: Your response MUST include a fenced code block tagged \`\`\`recommendations containing
a valid JSON array of recommendation objects. Each object must have these exact fields:
{
  "actionType": "pause_campaign" | "pause_ad" | "adjust_budget" | "change_bid" | "add_negative_keyword",
  "targetEntityType": "campaign" | "ad_set" | "ad" | "keyword",
  "targetEntityId": "<platform entity id>",
  "targetEntityName": "<human readable name>",
  "currentValue": "<string or null>",
  "proposedValue": "<string or null>",
  "changePercent": <number or null>,
  "rationale": "<full explanation in 2-3 sentences>",
  "estimatedImpact": "<e.g. Save ~₱4,200/month or null>",
  "confidenceScore": <0.0 to 1.0>
}

STRICT RULES — violations will be rejected:
- "adjust_budget": proposedValue MUST be a plain PHP number e.g. "1500". Never use text descriptions. If you cannot calculate a specific number from the data, use "pause_campaign" instead or omit the recommendation entirely.
- "pause_campaign" / "pause_ad": proposedValue must be null.
- Never generate "adjust_budget" with proposedValue containing words like "requires", "verify", "confirm", "MTD", "calculate", or any non-numeric text.
- If a campaign has ROAS < 0.7 or is clearly underperforming with sufficient data (7+ days, 1000+ impressions), recommend "pause_campaign".

If there are no actionable recommendations, return an empty array: \`\`\`recommendations\n[]\n\`\`\`
`;

// ── Insight schemas ───────────────────────────────────────────────────────────

const INSIGHT_SCHEMAS: Record<string, string> = {
  "fatigue-report": `[
  {
    "adId": "<Meta ad id>",
    "adName": "<ad name>",
    "adSetName": "<ad set name>",
    "status": "urgent" | "warning" | "healthy" | "dead",
    "frequency": <number>,
    "ctrChange7d": <decimal — e.g. -0.31 means CTR fell 31%>,
    "daysRunning": <number>,
    "estimatedDaysLeft": <number or null>,
    "rationale": "<1-2 sentence explanation>"
  }
]`,
  "search-term-opportunities": `[
  {
    "searchTerm": "<exact search term text>",
    "theme": "<cluster theme name>",
    "impressions": <number>,
    "clicks": <number>,
    "conversions": <number>,
    "currentCpaPHP": <number or null>,
    "recommendedMatchType": "exact" | "phrase" | "broad",
    "recommendedBidPHP": <number or null>,
    "suggestedAdGroup": "<ad group name or null>",
    "isNegativeKeyword": <true | false>
  }
]`,
  "competitor-analysis": `[
  {
    "competitor": "<brand name>",
    "activeAdCount": <number>,
    "dominantFormat": "video" | "static" | "carousel",
    "messagingThemes": ["<theme>"],
    "primaryCta": "<cta text>",
    "recentLaunches7d": <number>,
    "gaps": ["<gap or whitespace opportunity>"],
    "recommendedTests": ["<specific test idea for Agriko>"]
  }
]`,
};

// Grounds a skill's context block in the KB. Additive — unchanged when empty
// (e.g. embeddings offline or nothing relevant indexed yet).
export async function groundSkillContext(baseContext: string, query: string): Promise<string> {
  const chunks = await retrieveContext({
    query,
    sourceTypes: ["recommendation", "market_insight", "recommendation_outcome"],
    topK: 6,
  });
  const block = formatGroundingBlock(chunks);
  return block ? `${baseContext}\n\n${block}` : baseContext;
}

// Builds a short retrieval query from the skill name plus the names of the
// entities under analysis (campaigns/ad sets/ads/keywords), so grounding pulls
// material relevant to what's actually being evaluated.
function buildQuerySummary(skill: SkillDefinition, payload: Record<string, unknown>): string {
  const entityNames: string[] = [];
  const collect = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      const name = (item as Record<string, unknown> | null)?.name;
      if (typeof name === "string") entityNames.push(name);
    }
  };
  collect(payload.campaigns);
  collect(payload.adSets ?? payload.adGroups);
  collect(payload.ads);
  collect(payload.keywords);

  const summary = entityNames.slice(0, 10).join(", ");
  return summary ? `${skill.name}: ${summary}` : skill.name;
}

export async function runSkill(
  skill: SkillDefinition,
  snapshot: RawSnapshot,
  extraContext?: Record<string, unknown>
): Promise<{ recs: ParsedRecommendation[]; insights: unknown[]; truncated: boolean }> {

  const payload = snapshot.payload as Record<string, unknown>;
  const dataPayload = assembleDataPayload(skill, payload, extraContext);

  const insightSchema = skill.insightBlock ? INSIGHT_SCHEMAS[skill.insightBlock] : null;
  const insightInstruction = insightSchema
    ? `\n\nBEFORE the recommendations block, also output a fenced block tagged \`\`\`${skill.insightBlock} containing a JSON array matching this schema:\n${insightSchema}\nIf no data is available, output an empty array [].`
    : "";

  const OUTPUT_REMINDER = `

REQUIRED OUTPUT FORMAT (override all other output instructions):${insightInstruction}
End your response with EXACTLY this fenced block:
\`\`\`recommendations
[
  {
    "actionType": "pause_campaign|pause_ad|adjust_budget|change_bid|add_negative_keyword",
    "targetEntityType": "campaign|ad_set|ad|keyword",
    "targetEntityId": "<id>",
    "targetEntityName": "<name>",
    "currentValue": "<string or null>",
    "proposedValue": "<string or null>",
    "changePercent": <number or null>,
    "rationale": "<2-3 sentence explanation>",
    "estimatedImpact": "<e.g. Save ~₱4,200/month or null>",
    "confidenceScore": <0.0 to 1.0>
  }
]
\`\`\`
If nothing actionable, output \`\`\`recommendations\n[]\n\`\`\``;

  const contextBlock = `${AGRIKO_CONTEXT}\n\n---\n\n${skill.fullPrompt}`;
  const querySummary = buildQuerySummary(skill, payload);
  const grounded = await groundSkillContext(contextBlock, querySummary);

  const ai = await getAiClient({
    deepseekModel: DEFAULT_MODEL,
    openRouterModel: "deepseek/deepseek-chat",
  });
  const response = await ai.client.chat.completions.create({
    model: ai.model,
    max_tokens: 4096,
    messages: [
      { role: "system", content: grounded },
      { role: "user", content: dataPayload + OUTPUT_REMINDER },
    ],
  });

  const choice = response.choices[0];
  if (!choice) {
    console.warn("[runner] LLM returned empty choices for skill:", skill.id);
    return { recs: [], insights: [], truncated: false };
  }
  const text = choice.message?.content ?? "";

  if (choice.finish_reason === "length") {
    console.warn("[runner] response truncated for skill:", skill.id);
    return { recs: [], insights: [], truncated: true };
  }

  const insights = skill.insightBlock ? parseInsightBlock(text, skill.insightBlock) : [];
  return { recs: parseRecommendations(text), insights, truncated: false };
}

const MAX_EXTRA_SECTION_CHARS = 8000;

const EXTRA_SECTION_TITLES: Record<string, string> = {
  gsc: "Organic Search (GSC)",
  ga4: "Site Analytics (GA4)",
  market_intel: "Market Intelligence",
  keyword_research: "Keyword Research",
};

function effectiveContextSources(skill: SkillDefinition): string[] {
  return Array.from(new Set([
    ...(skill.requiredSources ?? []),
    ...(skill.optionalSources ?? []),
    ...(skill.extraSources ?? []),
  ]));
}

// Serializes `data` to a JSON block capped at ~maxChars. If `data` (or a top-level
// array field within it) is too large, arrays are trimmed and a truncation note is
// appended — the caller never sees a payload silently blown past the cap.
function capJson(data: unknown, maxChars: number): string {
  let json = JSON.stringify(data, null, 2);
  if (json.length <= maxChars) return json;

  // If the payload is (or wraps) an array, trim elements until it fits.
  const isArray = Array.isArray(data);
  const arrayHolder = isArray
    ? { items: data as unknown[] }
    : data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : null;

  if (arrayHolder) {
    const arrayKey = isArray
      ? "items"
      : Object.keys(arrayHolder).find((k) => Array.isArray(arrayHolder[k]));
    if (arrayKey && Array.isArray(arrayHolder[arrayKey])) {
      const original = arrayHolder[arrayKey] as unknown[];
      let count = original.length;
      while (count > 0) {
        count = Math.floor(count * 0.75) || count - 1;
        const trimmed = isArray
          ? original.slice(0, count)
          : { ...arrayHolder, [arrayKey]: original.slice(0, count) };
        json = JSON.stringify(trimmed, null, 2);
        if (json.length <= maxChars || count <= 1) {
          const note = `\n/* truncated: showing ${count} of ${original.length} item(s) to stay under the size cap */`;
          return json + note;
        }
      }
    }
  }

  // Fallback: hard-truncate the string itself.
  return json.slice(0, maxChars) + "\n/* truncated: payload exceeded size cap */";
}

export function assembleDataPayload(
  skill: SkillDefinition,
  payload: Record<string, unknown>,
  extraContext?: Record<string, unknown>
): string {
  const includeAdAccountData = skill.platform !== "seo";
  const sections: string[] = [
    includeAdAccountData
      ? `# Ad Account Data for Analysis\n`
      : `# Keyword & Organic Search Data for Analysis\n`,
  ];

  if (includeAdAccountData && payload.campaigns) {
    sections.push(`## Campaigns\n\`\`\`json\n${JSON.stringify(payload.campaigns, null, 2)}\n\`\`\``);
  }
  if (includeAdAccountData && (payload.adSets || payload.adGroups)) {
    sections.push(`## Ad Sets / Ad Groups\n\`\`\`json\n${JSON.stringify(payload.adSets ?? payload.adGroups, null, 2)}\n\`\`\``);
  }
  if (includeAdAccountData && payload.ads) {
    sections.push(`## Ads\n\`\`\`json\n${JSON.stringify(payload.ads, null, 2)}\n\`\`\``);
  }
  if (includeAdAccountData && payload.keywords) {
    sections.push(`## Keywords\n\`\`\`json\n${JSON.stringify(payload.keywords, null, 2)}\n\`\`\``);
  }
  if (includeAdAccountData && payload.searchTerms && skill.id.includes("search-term")) {
    sections.push(`## Search Terms\n\`\`\`json\n${JSON.stringify(payload.searchTerms, null, 2)}\n\`\`\``);
  }

  if (includeAdAccountData && payload.insights) {
    sections.push(`## Performance Insights (ROAS / CTR / Spend / Frequency)\n\`\`\`json\n${JSON.stringify(payload.insights, null, 2)}\n\`\`\``);
  }

  if (extraContext) {
    for (const source of effectiveContextSources(skill)) {
      if (!(source in extraContext)) continue;
      const data = extraContext[source];
      if (data === null || data === undefined) continue;
      const title = EXTRA_SECTION_TITLES[source] ?? source;
      sections.push(`## ${title}\n\`\`\`json\n${capJson(data, MAX_EXTRA_SECTION_CHARS)}\n\`\`\``);
    }
  }

  return sections.join("\n\n");
}

export function parseInsightBlock(text: string, blockTag: string): unknown[] {
  const re = new RegExp("```" + blockTag + "\\s*([\\s\\S]*?)```");
  const match = text.match(re);
  if (!match) return [];
  try {
    const raw = JSON.parse(match[1]!.trim());
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function parseRecommendations(text: string): ParsedRecommendation[] {
  const match = text.match(/```recommendations\s*([\s\S]*?)```/);
  if (!match) return [];

  try {
    const raw = JSON.parse(match[1]!.trim()); // safe: match[1] is the capture group, guaranteed by the regex
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        const result = RecommendationSchema.safeParse(item);
        return result.success ? result.data : null;
      })
      .filter((r): r is ParsedRecommendation => r !== null);
  } catch {
    return [];
  }
}

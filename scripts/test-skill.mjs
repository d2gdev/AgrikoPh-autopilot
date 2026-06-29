import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as yaml from "js-yaml";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: { "HTTP-Referer": "https://agrikoph.com", "X-Title": "Agriko Autopilot" },
});

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required");
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return { content: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { content: raw };
  yaml.load(raw.slice(4, end));
  const contentStart = raw.startsWith("\n", end + 4) ? end + 5 : end + 4;
  return { content: raw.slice(contentStart) };
}

const raw = fs.readFileSync(path.join(root, "skills-source/01-google-and-meta-cpa-diagnostics.md"), "utf-8");
const { content: skillPrompt } = parseFrontmatter(raw);

const AGRIKO_CONTEXT = `
You are analyzing advertising data for Agriko (agrikoph.com), a Philippine health food brand.
Store currency: PHP (₱). Industry: health/wellness e-commerce. Location: Philippines.

CRITICAL: Your response MUST include a fenced code block tagged \`\`\`recommendations containing a valid JSON array.
Each object must have these exact fields:
  actionType, targetEntityType, targetEntityId, targetEntityName,
  currentValue, proposedValue, changePercent, rationale,
  estimatedImpact, confidenceScore, conversionCount, dailyBudgetPhp
If no recommendations return: \`\`\`recommendations\n[]\n\`\`\`
`;

const OUTPUT_REMINDER = `\n\nNow output your recommendations as a fenced JSON block. You MUST end your response with:\n\`\`\`recommendations\n[ ...array of recommendation objects... ]\n\`\`\`\nIf nothing actionable, output \`\`\`recommendations\n[]\n\`\`\``;

const mockData = `## Campaigns
\`\`\`json
[{"id":"123","name":"Ryze Matcha - TOF","status":"ENABLED","spend7d":12000,"conversions":3,"cpa":4000,"roas":1.2,"daily_budget":2000}]
\`\`\`` + OUTPUT_REMINDER;

console.log("Calling OpenRouter with skill 01 + mock data...");
const response = await client.chat.completions.create({
  model: "google/gemini-3.5-flash",
  max_tokens: 2048,
  messages: [
    { role: "system", content: `${skillPrompt.trim()}\n\n${AGRIKO_CONTEXT}` },
    { role: "user", content: mockData },
  ],
});

const text = response.choices[0]?.message?.content ?? "";
console.log("\n--- Raw response snippet ---");
console.log(text);

const match = text.match(/```recommendations\s*([\s\S]*?)```/);
if (!match) {
  console.log("\n❌ No recommendations block found in response");
  process.exit(1);
}

try {
  const recs = JSON.parse(match[1].trim());
  console.log(`\n✅ Parsed ${recs.length} recommendation(s)`);
  if (recs.length > 0) {
    const r = recs[0];
    console.log(`  actionType: ${r.actionType}`);
    console.log(`  target: ${r.targetEntityName}`);
    console.log(`  rationale: ${r.rationale?.slice(0, 100)}...`);
    console.log(`  confidence: ${r.confidenceScore}`);
  }
} catch (e) {
  console.log("❌ JSON parse failed:", e.message);
  console.log(match[1].slice(0, 300));
  process.exit(1);
}

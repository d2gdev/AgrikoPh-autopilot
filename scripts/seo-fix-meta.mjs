/**
 * Create seo-fix proposals for high-traffic organic rice / farming blog posts.
 * Updates meta title + meta description to target exact-match queries including
 * "organic rice benefits Philippines", "types of organic rice", etc.
 *
 * Usage:
 *   node scripts/seo-fix-meta.mjs
 *   node scripts/seo-fix-meta.mjs --dry-run
 *   node scripts/seo-fix-meta.mjs --env .env.production
 */

import dotenv from "dotenv";
import process from "process";

const DRY_RUN = process.argv.includes("--dry-run");
const argIdx = process.argv.indexOf("--env");
const envFile = argIdx !== -1 ? (process.argv[argIdx + 1] ?? ".env") : ".env";
dotenv.config({ path: envFile, override: true });

if (!process.env.DATABASE_URL && process.env.DATABASE_URL_PROD) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
}

const REQUIRED = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN", "DATABASE_URL"];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) { console.error(`Missing env vars: ${missing.join(", ")}`); process.exit(1); }

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const GQL = `https://${STORE}/admin/api/2025-01/graphql.json`;

async function gqlFetch(query, variables = {}) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

async function fetchMeta(handle) {
  const data = await gqlFetch(
    `query($q: String!) {
      articles(first: 1, query: $q) {
        edges {
          node {
            id handle title
            seoTitle: metafield(namespace: "global", key: "title_tag") { value }
            seoDesc:  metafield(namespace: "global", key: "description_tag") { value }
          }
        }
      }
    }`,
    { q: `handle:'${handle}'` }
  );
  const node = data.articles.edges[0]?.node;
  if (!node) return null;
  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    metaTitle: node.seoTitle?.value ?? null,
    metaDesc: node.seoDesc?.value ?? null,
  };
}

// ── Target definitions ─────────────────────────────────────────────────────────
// metaTitle: 50–60 chars  |  metaDesc: 145–160 chars
// Every desc ends with a CTA and includes a Philippines geo-qualifier.

const TARGETS = [
  {
    handle: "organic-rice-benefits-why-philippine-organic-rice-is-a-smart-choice",
    metaTitle: "Organic Rice Benefits Philippines | Agriko",
    metaDesc:
      "Discover the real organic rice benefits in the Philippines—no synthetic pesticides, richer nutrients, and better soil. Shop Agriko's certified black and red rice.",
    targetQuery: "organic rice benefits Philippines",
  },
  {
    handle: "types-of-organic-rice",
    metaTitle: "Types of Organic Rice Philippines: Black, Red & Brown | Agriko",
    metaDesc:
      "Compare types of organic rice in the Philippines—black rice, red rice, and brown rice. Nutrition, flavour, and cooking guide. Buy certified organic from Agriko Farm.",
    targetQuery: "types of organic rice Philippines",
  },
  {
    handle: "organic-rice-philippines-benefits-varieties-complete-nutrition-guide",
    metaTitle: "Organic Rice Philippines: Benefits, Varieties & Nutrition | Agriko",
    metaDesc:
      "Complete guide to organic rice in the Philippines. Compare black, red, and brown rice nutrition, benefits, and varieties. Sustainably grown at Agriko Organic Farm.",
    targetQuery: "organic rice Philippines",
  },
  {
    handle: "what-is-organic-rice-a-plain-language-guide",
    metaTitle: "What Is Organic Rice? A Plain-Language Guide | Agriko",
    metaDesc:
      "What makes rice organic in the Philippines? Learn how certification works, which farming practices qualify, and how Agriko's organic rice differs from conventional grain.",
    targetQuery: "what is organic rice Philippines",
  },
  {
    handle: "where-to-buy-organic-rice-in-the-philippines",
    metaTitle: "Where to Buy Organic Rice in the Philippines | Agriko",
    metaDesc:
      "Find genuine organic rice in the Philippines. What to look for on the bag, how to verify certification, and where to buy Agriko's certified organic black and red rice.",
    targetQuery: "where to buy organic rice Philippines",
  },
  {
    handle: "black-rice-philippines",
    metaTitle: "Black Rice Philippines: Benefits, Nutrition & Where to Buy | Agriko",
    metaDesc:
      "Everything about black rice in the Philippines—nutrition, antioxidant benefits, cooking tips, and where to buy certified organic black rice direct from Agriko Farm.",
    targetQuery: "black rice Philippines",
  },
  {
    handle: "red-rice-philippines",
    metaTitle: "Red Rice Philippines: Benefits, Nutrition & Where to Buy | Agriko",
    metaDesc:
      "Complete guide to red rice in the Philippines—nutrition facts, fibre content, flavour profile, and where to buy certified organic red rice direct from Agriko Farm.",
    targetQuery: "red rice Philippines",
  },
];

// ── Main ───────────────────────────────────────────────────────────────────────

console.log(`\nSEO Meta Fix${DRY_RUN ? " [DRY RUN]" : ""}\n${"─".repeat(50)}`);

let created = 0, skipped = 0;

for (const target of TARGETS) {
  process.stdout.write(`\n[${target.handle}]\n  fetching current meta… `);
  const current = await fetchMeta(target.handle);

  if (!current) {
    console.log("NOT FOUND in Shopify — skipping");
    skipped++;
    continue;
  }

  console.log(`OK`);
  console.log(`  current title: ${current.metaTitle ?? "(none)"}`);
  console.log(`  current desc:  ${current.metaDesc?.slice(0, 80) ?? "(none)"}…`);
  console.log(`  new title:     ${target.metaTitle}`);
  console.log(`  new desc:      ${target.metaDesc.slice(0, 80)}…`);

  if (DRY_RUN) { continue; }

  // Skip if an active seo-fix proposal already exists for this article
  const existing = await prisma.contentProposal.findFirst({
    where: {
      articleHandle: target.handle,
      proposalType: "seo-fix",
      status: { in: ["pending", "approved"] },
    },
    select: { id: true },
  });
  if (existing) {
    console.log(`  ⟳ pending/approved seo-fix already exists (${existing.id}) — skipping`);
    skipped++;
    continue;
  }

  await prisma.contentProposal.create({
    data: {
      articleHandle: target.handle,
      proposalType: "seo-fix",
      changeType: "metadata",
      priority: "High",
      impact: "High",
      effort: "Low",
      title: `SEO meta update — ${current.title}`,
      description: `Update meta title and description to target the query "${target.targetQuery}". Includes geo-qualifier "Philippines" and a product CTA.`,
      proposedState: {
        articleHandle: target.handle,
        targetQuery: target.targetQuery,
        metaTitle: target.metaTitle,
        metaDescription: target.metaDesc,
      },
      sourceData: {
        rationale: "High-traffic post; meta description does not include the target query or a clear CTA. Adding geo-qualifier and exact-match phrase improves CTR from search results.",
        previousMetaTitle: current.metaTitle,
        previousMetaDesc: current.metaDesc,
        seededBy: "scripts/seo-fix-meta.mjs",
      },
      draftContent: {
        metaTitle: target.metaTitle,
        metaDescription: target.metaDesc,
      },
      draftStatus: "ready",
      draftGeneratedAt: new Date(),
    },
  });
  console.log(`  ✓ proposal created`);
  created++;
}

await prisma.$disconnect();
console.log(`\n${"─".repeat(50)}`);
console.log(`Done. Created: ${created}  Skipped: ${skipped}`);
if (!DRY_RUN && created > 0) {
  console.log(`\nApprove proposals in Content Pilot → they publish via metafieldsSet to Shopify.\n`);
}

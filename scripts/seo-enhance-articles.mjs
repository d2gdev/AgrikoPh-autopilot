/**
 * Seed content-refresh proposals that add exact-match H2s and product internal
 * links to high-ranking blog posts about rice benefits and organic farming.
 *
 * Creates ContentProposal records (status = "pending") — the operator must
 * approve them in the Content Pilot UI before any Shopify write happens.
 *
 * Usage:
 *   node scripts/seo-enhance-articles.mjs
 *   node scripts/seo-enhance-articles.mjs --dry-run   # preview HTML only
 *   node scripts/seo-enhance-articles.mjs --env .env.production
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
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

// ── Config ─────────────────────────────────────────────────────────────────────

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const GQL = `https://${STORE}/admin/api/2025-01/graphql.json`;

// Articles to enhance: handle → { h2, products to link }
const TARGETS = [
  // ── H2-enhancement posts (also get product links) ──
  {
    handle: "organic-rice-benefits-why-philippine-organic-rice-is-a-smart-choice",
    h2: "Benefits of Organic Rice",
    description: "Add exact-match H2 'Benefits of Organic Rice' and internal product links",
  },
  {
    handle: "types-of-organic-rice",
    h2: "Types of Organic Rice",
    description: "Add exact-match H2 'Types of Organic Rice' and internal product links",
  },
  // ── Product-link-only posts ──
  {
    handle: "organic-rice-philippines-benefits-varieties-complete-nutrition-guide",
    h2: null,
    description: "Add internal links to organic rice product pages",
  },
  {
    handle: "what-is-organic-rice-a-plain-language-guide",
    h2: null,
    description: "Add internal links to organic rice product pages",
  },
  {
    handle: "where-to-buy-organic-rice-in-the-philippines",
    h2: null,
    description: "Add internal links to organic rice product pages",
  },
  {
    handle: "what-is-organic-farming",
    h2: null,
    description: "Add internal links to organic rice product pages",
  },
  {
    handle: "sustainable-rice-farming",
    h2: null,
    description: "Add internal links to organic rice product pages",
  },
  {
    handle: "biodiversity-in-organic-farming-systems",
    h2: null,
    description: "Add internal links to organic rice product pages",
  },
];

// Product links to weave into body text (first occurrence of each term only)
const INLINE_LINKS = [
  { term: "black rice", href: "/products/rice-black", label: "Organic Black Rice" },
  { term: "red rice", href: "/products/rice-red", label: "Organic Red Rice" },
];

// CTA block appended before the end of the body — idempotent via data attribute
const CTA_MARKER = "data-seo-product-links";
const CTA_HTML = `<p ${CTA_MARKER}="true"><strong>Shop Agriko's organic rice:</strong> Try our ` +
  `<a href="/products/rice-black">Organic Black Rice</a> or ` +
  `<a href="/products/rice-red">Organic Red Rice</a>, and ` +
  `<a href="/collections/organic-rice">browse our full organic rice collection</a>.</p>`;

// ── Shopify helpers ────────────────────────────────────────────────────────────

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

async function fetchArticle(handle) {
  const data = await gqlFetch(
    `query($q: String!) {
      articles(first: 1, query: $q) {
        edges { node { id title handle body tags } }
      }
    }`,
    { q: `handle:'${handle}'` }
  );
  return data.articles.edges[0]?.node ?? null;
}

// ── HTML enrichment ────────────────────────────────────────────────────────────

/**
 * Inject an <h2> after the first closing </p> if no equivalent H2 already exists.
 */
function injectH2(body, h2Text) {
  // Already has this exact H2 (case-insensitive)
  const re = new RegExp(`<h2[^>]*>\\s*${h2Text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</h2>`, "i");
  if (re.test(body)) return body;

  // Insert after first </p>
  const insertAfter = "</p>";
  const idx = body.indexOf(insertAfter);
  if (idx === -1) return `<h2>${h2Text}</h2>\n\n` + body;

  const insertAt = idx + insertAfter.length;
  return body.slice(0, insertAt) + `\n\n<h2>${h2Text}</h2>` + body.slice(insertAt);
}

/**
 * Wrap the first plain-text occurrence of `term` (not already inside an <a>)
 * with a product link. Case-insensitive, full-word match.
 */
function injectInlineLink(body, term, href) {
  // Quick skip: if term never appears in body at all
  if (!body.toLowerCase().includes(term.toLowerCase())) return body;

  // We want to match the term only when NOT already inside an anchor.
  // Strategy: split on <a ...>...</a> segments and only replace in text gaps.
  let injected = false;
  return body.replace(/(<a\b[^>]*>[\s\S]*?<\/a>)|([^<]+)/gi, (match, anchor, text) => {
    if (anchor) return anchor; // inside an existing link — leave alone
    if (injected || !text) return match;
    const wordRe = new RegExp(`\\b(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i");
    if (!wordRe.test(text)) return text;
    injected = true;
    return text.replace(wordRe, `<a href="${href}">$1</a>`);
  });
}

/**
 * Append the product CTA block if not already present.
 */
function appendCta(body) {
  if (body.includes(CTA_MARKER)) return body;
  return body.trimEnd() + "\n\n" + CTA_HTML;
}

function enrichBody(body, h2) {
  let out = body;
  if (h2) out = injectH2(out, h2);
  for (const { term, href } of INLINE_LINKS) {
    out = injectInlineLink(out, term, href);
  }
  out = appendCta(out);
  return out;
}

// ── Main ───────────────────────────────────────────────────────────────────────

console.log(`\nSEO Article Enhancer${DRY_RUN ? " [DRY RUN]" : ""}\n${"─".repeat(50)}`);

let created = 0;
let skipped = 0;

for (const target of TARGETS) {
  process.stdout.write(`\n[${target.handle}] fetching… `);
  const article = await fetchArticle(target.handle);

  if (!article) {
    console.log("NOT FOUND in Shopify — skipping");
    skipped++;
    continue;
  }

  const enriched = enrichBody(article.body, target.h2);

  if (enriched === article.body) {
    console.log("already enhanced — skipping");
    skipped++;
    continue;
  }

  if (DRY_RUN) {
    console.log(`OK — would create proposal\n\nEnriched HTML preview (first 800 chars):\n`);
    console.log(enriched.slice(0, 800) + (enriched.length > 800 ? "\n…" : ""));
    continue;
  }

  // Check if an active proposal for this article already exists
  const existing = await prisma.contentProposal.findFirst({
    where: {
      articleHandle: target.handle,
      proposalType: "content-refresh",
      status: { in: ["pending", "approved"] },
    },
    select: { id: true },
  });
  if (existing) {
    console.log(`pending/approved proposal already exists (${existing.id}) — skipping`);
    skipped++;
    continue;
  }

  await prisma.contentProposal.create({
    data: {
      articleHandle: target.handle,
      proposalType: "content-refresh",
      changeType: "content",
      priority: "Medium",
      impact: "Medium",
      effort: "Low",
      title: target.h2
        ? `Add exact-match H2 & product links — ${article.title}`
        : `Add product internal links — ${article.title}`,
      description: target.description,
      proposedState: {
        articleHandle: target.handle,
        blogHandle: "news",
        changes: [
          ...(target.h2 ? [{ type: "h2", text: target.h2 }] : []),
          { type: "internal_links", targets: ["/products/rice-black", "/products/rice-red", "/collections/organic-rice"] },
        ],
      },
      sourceData: {
        rationale: "Existing post ranks well; exact-match H2 and product links will improve click-through and pass PageRank to product pages.",
        seededBy: "scripts/seo-enhance-articles.mjs",
        originalBodyLength: article.body.length,
      },
      draftContent: { bodyHtml: enriched },
      draftStatus: "ready",
      draftGeneratedAt: new Date(),
    },
  });

  console.log("✓ proposal created");
  created++;
}

await prisma.$disconnect();

console.log(`\n${"─".repeat(50)}`);
console.log(`Done. Created: ${created}  Skipped: ${skipped}`);
if (!DRY_RUN && created > 0) {
  console.log(`\nReview and approve proposals in the Content Pilot UI.\n`);
}

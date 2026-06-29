/**
 * Task 1 — Create Shopify URL redirects from REDIRECTS (Appendix B).
 *
 * VERIFIED via Shopify Admin GraphQL 2025-01 docs (shopify.dev) on 2026-06-24:
 *
 *   Query:    urlRedirects(first: Int, query: String): UrlRedirectConnection
 *               nodes { id  path  target }
 *             Filter syntax: query: "path:/some/path"
 *
 *   Mutation: urlRedirectCreate(urlRedirect: UrlRedirectInput!): UrlRedirectCreatePayload
 *               UrlRedirectInput: { path: String!  target: String! }
 *               Payload:          urlRedirect { id  path  target }
 *                                 userErrors  { field  message }
 *
 *   Field names confirmed as `path` and `target` (NOT `from`/`to`).
 *   userErrors type is UrlRedirectUserError (field: String[], message: String).
 *
 * Usage:
 *   Preview:  cd /opt/autopilot && npx tsx scripts/seo-remediation/01-redirects.ts
 *   Apply:    cd /opt/autopilot && APPLY=1 npx tsx scripts/seo-remediation/01-redirects.ts
 */

import { APPLY, log, banner, gql, assertNoUserErrors, summary } from "./_lib";
import { REDIRECTS, type Redirect } from "./_data";

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

interface UrlRedirectNode {
  id: string;
  path: string;
  target: string;
}

interface UrlRedirectsResult {
  urlRedirects: {
    nodes: UrlRedirectNode[];
  };
}

interface UrlRedirectCreateResult {
  urlRedirectCreate: {
    urlRedirect: UrlRedirectNode | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the existing redirect for `path`, or null if none exists. */
async function fetchExisting(path: string): Promise<UrlRedirectNode | null> {
  // Shopify query filter syntax: path:/some/path
  const data = await gql<UrlRedirectsResult>(
    `query($q: String!) {
      urlRedirects(first: 250, query: $q) {
        nodes { id path target }
      }
    }`,
    { q: `path:${path}` }
  );
  // The query filter is a substring search, so confirm an exact match.
  return data.urlRedirects.nodes.find((n) => n.path === path) ?? null;
}

/** Create a redirect and return the created node. */
async function createRedirect(path: string, target: string): Promise<UrlRedirectNode> {
  const data = await gql<UrlRedirectCreateResult>(
    `mutation($input: UrlRedirectInput!) {
      urlRedirectCreate(urlRedirect: $input) {
        urlRedirect { id path target }
        userErrors { field message }
      }
    }`,
    { input: { path, target } }
  );
  assertNoUserErrors("urlRedirectCreate", data.urlRedirectCreate.userErrors);
  // assertNoUserErrors throws if there are errors, so urlRedirect is always set here.
  return data.urlRedirectCreate.urlRedirect!;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  banner("01-redirects — create Shopify URL redirects");

  log(`\nProcessing ${REDIRECTS.length} redirect(s)...\n`);

  const rows: Array<{ item: string; status: string }> = [];

  for (const r of REDIRECTS) {
    const label = `[${r.id}] ${r.from} → ${r.to}`;

    if (!APPLY) {
      // Dry-run: still query for existing so the preview is accurate.
      const existing = await fetchExisting(r.from);
      if (existing) {
        log(`  WOULD SKIP  ${label}  (already exists: ${existing.id})`);
        rows.push({ item: label, status: "exists (would skip)" });
      } else {
        log(`  WOULD CREATE  ${label}  — ${r.reason}`);
        rows.push({ item: label, status: "would create" });
      }
      continue;
    }

    // Live run
    const existing = await fetchExisting(r.from);
    if (existing) {
      log(`  SKIP    ${label}  (exists: ${existing.id}, target: ${existing.target})`);
      rows.push({ item: label, status: "exists" });
      continue;
    }

    const created = await createRedirect(r.from, r.to);
    log(`  CREATED ${label}  (id: ${created.id})`);
    rows.push({ item: label, status: "created" });
  }

  summary(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

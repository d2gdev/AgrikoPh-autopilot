/**
 * Task 6 — Collection remediation (keepers descriptions/SEO, rice de-padding, noindex).
 *
 * Run via tsx on prod through the app's Admin client (lib/shopify-admin.ts), which
 * resolves the token DB-first and auto-refreshes on 401. Admin GraphQL 2025-01.
 *
 *   Preview:  cd /opt/autopilot && npx tsx scripts/seo-remediation/04-collections.ts
 *   Apply:    cd /opt/autopilot && APPLY=1 npx tsx scripts/seo-remediation/04-collections.ts
 *
 * VERIFIED against Shopify Admin GraphQL 2025-01 docs (shopify.dev):
 *
 *  - collectionByHandle(handle): Collection has fields id, descriptionHtml,
 *    seo { title description }, ruleSet { appliedDisjunctively rules { column relation
 *    condition } }, and metafield(namespace, key) { value }. There is NO reliable
 *    top-level `isAutomated` field exposed for querying, so we detect MANUAL vs
 *    AUTOMATED by whether `ruleSet` is non-null. A smart (automated) collection always
 *    has a ruleSet; a manual collection returns ruleSet = null. This is exactly what
 *    Shopify's own `isAutomated` is derived from.
 *
 *  - collectionUpdate(input: CollectionInput!): CollectionInput accepts id,
 *    descriptionHtml, and seo: SEOInput { title description }. Returns
 *    { collection { ... } userErrors { field message } }.
 *
 *  - collectionRemoveProducts(id: ID!, productIds: [ID!]!): can ONLY remove products
 *    from a MANUAL collection (you cannot remove individual products from a smart
 *    collection — its membership is rule-driven). It returns an ASYNC payload:
 *      { job { id done } userErrors { field message } }
 *    The removal runs as a background Job; `job.done` may be false immediately after
 *    the mutation. We report the job id and its `done` flag and DO NOT block on it.
 *
 *  - metafieldsSet(metafields: [MetafieldsSetInput!]!): each entry requires
 *    ownerId, namespace, key, type, value. Returns { metafields { ... } userErrors {...} }.
 *    For noindex we set seo.hidden (type "boolean") to "true".
 */
import { gql, APPLY, log, banner, assertNoUserErrors, idByHandle, summary } from "./_lib";
import {
  COLLECTION_KEEPERS,
  REMOVE_RICE_PADDING,
  NOINDEX_COLLECTIONS,
  NOINDEX_METAFIELD,
  RICE_HANDLES,
} from "./_data";

type SummaryRow = { item: string; status: string };
const rows: SummaryRow[] = [];

interface CollectionRule {
  column: string;
  relation: string;
  condition: string;
}
interface CollectionDetail {
  id: string;
  handle: string;
  descriptionHtml: string;
  seo: { title: string | null; description: string | null };
  ruleSet: { appliedDisjunctively: boolean; rules: CollectionRule[] } | null;
}

const COLLECTION_QUERY = `
  query($h: String!) {
    collectionByHandle(handle: $h) {
      id
      handle
      descriptionHtml
      seo { title description }
      ruleSet { appliedDisjunctively rules { column relation condition } }
    }
  }
`;

async function fetchCollection(handle: string): Promise<CollectionDetail | null> {
  const d = await gql<{ collectionByHandle: CollectionDetail | null }>(COLLECTION_QUERY, { h: handle });
  return d.collectionByHandle;
}

/** Strip HTML/whitespace noise so we don't churn on cosmetic diffs. */
function norm(s: string | null | undefined): string {
  return (s ?? "").trim();
}

// ---------------------------------------------------------------------------
// 1. Keepers — descriptionHtml + seo { title, description }
// ---------------------------------------------------------------------------
async function applyKeepers() {
  banner("Task 6a — collection keepers (description + SEO)");
  for (const spec of COLLECTION_KEEPERS) {
    const col = await fetchCollection(spec.handle);
    if (!col) {
      log(`  [skip] ${spec.handle}: collection not found`);
      rows.push({ item: `keeper ${spec.handle}`, status: "NOT FOUND" });
      continue;
    }

    const descMatches = norm(col.descriptionHtml) === norm(spec.bodyHtml);
    const titleMatches = norm(col.seo.title) === norm(spec.seoTitle);
    const metaMatches = norm(col.seo.description) === norm(spec.seoDescription);

    if (descMatches && titleMatches && metaMatches) {
      log(`  [ok] ${spec.handle}: already up to date`);
      rows.push({ item: `keeper ${spec.handle}`, status: "ALREADY SET" });
      continue;
    }

    log(`  [change] ${spec.handle}:`);
    if (!descMatches) log(`      descriptionHtml -> ${spec.bodyHtml.slice(0, 80)}...`);
    if (!titleMatches) log(`      seo.title       -> ${spec.seoTitle}`);
    if (!metaMatches) log(`      seo.description -> ${spec.seoDescription}`);

    if (!APPLY) {
      rows.push({ item: `keeper ${spec.handle}`, status: "WOULD UPDATE" });
      continue;
    }

    const res = await gql<{
      collectionUpdate: { collection: { id: string } | null; userErrors: { field?: string[] | null; message: string }[] };
    }>(
      `mutation($input: CollectionInput!) {
        collectionUpdate(input: $input) {
          collection { id }
          userErrors { field message }
        }
      }`,
      {
        input: {
          id: col.id,
          descriptionHtml: spec.bodyHtml,
          seo: { title: spec.seoTitle, description: spec.seoDescription },
        },
      }
    );
    assertNoUserErrors(`collectionUpdate ${spec.handle}`, res.collectionUpdate.userErrors);
    log(`      updated.`);
    rows.push({ item: `keeper ${spec.handle}`, status: "UPDATED" });
  }
}

// ---------------------------------------------------------------------------
// 2. Remove rice padding — manual collections only; warn on automated ones
// ---------------------------------------------------------------------------
async function removeRicePadding() {
  banner("Task 6b — remove rice SKUs from padding collections");

  // Resolve the rice product ids once.
  const riceProductIds: string[] = [];
  for (const h of RICE_HANDLES) {
    const p = await idByHandle("product", h);
    if (!p) {
      log(`  [warn] rice product handle not found: ${h}`);
      continue;
    }
    riceProductIds.push(p.id);
  }
  log(`  rice product ids: ${riceProductIds.join(", ") || "(none resolved!)"}`);

  for (const handle of REMOVE_RICE_PADDING) {
    const col = await fetchCollection(handle);
    if (!col) {
      log(`  [skip] ${handle}: collection not found`);
      rows.push({ item: `de-pad ${handle}`, status: "NOT FOUND" });
      continue;
    }

    // ruleSet != null  =>  AUTOMATED (smart) collection.
    if (col.ruleSet) {
      log(
        `  [MANUAL ACTION NEEDED] collection ${handle} is automated; ` +
          `adjust its rules to exclude rice (cannot remove individual products).`
      );
      log(
        `      current rules (${col.ruleSet.appliedDisjunctively ? "ANY" : "ALL"}): ` +
          col.ruleSet.rules.map((r) => `${r.column} ${r.relation} "${r.condition}"`).join("; ")
      );
      rows.push({ item: `de-pad ${handle}`, status: "MANUAL ACTION NEEDED (automated)" });
      continue;
    }

    if (!riceProductIds.length) {
      log(`  [skip] ${handle}: no rice product ids resolved`);
      rows.push({ item: `de-pad ${handle}`, status: "NO RICE IDS" });
      continue;
    }

    log(`  [change] ${handle} (manual): remove ${riceProductIds.length} rice product(s)`);
    if (!APPLY) {
      rows.push({ item: `de-pad ${handle}`, status: "WOULD REMOVE" });
      continue;
    }

    const res = await gql<{
      collectionRemoveProducts: {
        job: { id: string; done: boolean } | null;
        userErrors: { field?: string[] | null; message: string }[];
      };
    }>(
      `mutation($id: ID!, $productIds: [ID!]!) {
        collectionRemoveProducts(id: $id, productIds: $productIds) {
          job { id done }
          userErrors { field message }
        }
      }`,
      { id: col.id, productIds: riceProductIds }
    );
    assertNoUserErrors(`collectionRemoveProducts ${handle}`, res.collectionRemoveProducts.userErrors);
    const job = res.collectionRemoveProducts.job;
    // Removal runs as a background Job — report it, do NOT block on completion.
    log(`      enqueued job ${job?.id ?? "(none)"} (done=${job?.done ?? "unknown"})`);
    rows.push({ item: `de-pad ${handle}`, status: `JOB ${job?.done ? "done" : "queued"}` });
  }
}

// ---------------------------------------------------------------------------
// 3. Noindex metafield (seo.hidden = true)
// ---------------------------------------------------------------------------
async function applyNoindex() {
  banner(`Task 6c — noindex metafield (${NOINDEX_METAFIELD.namespace}.${NOINDEX_METAFIELD.key} = true)`);
  const TARGET_VALUE = "true";

  for (const handle of NOINDEX_COLLECTIONS) {
    const detail = await gql<{
      collectionByHandle: {
        id: string;
        metafield: { value: string } | null;
      } | null;
    }>(
      `query($h: String!, $ns: String!, $k: String!) {
        collectionByHandle(handle: $h) {
          id
          metafield(namespace: $ns, key: $k) { value }
        }
      }`,
      { h: handle, ns: NOINDEX_METAFIELD.namespace, k: NOINDEX_METAFIELD.key }
    );
    const col = detail.collectionByHandle;
    if (!col) {
      log(`  [skip] ${handle}: collection not found`);
      rows.push({ item: `noindex ${handle}`, status: "NOT FOUND" });
      continue;
    }

    if (col.metafield && col.metafield.value === TARGET_VALUE) {
      log(`  [ok] ${handle}: already noindexed`);
      rows.push({ item: `noindex ${handle}`, status: "ALREADY SET" });
      continue;
    }

    log(`  [change] ${handle}: set ${NOINDEX_METAFIELD.namespace}.${NOINDEX_METAFIELD.key} = ${TARGET_VALUE}`);
    if (!APPLY) {
      rows.push({ item: `noindex ${handle}`, status: "WOULD SET" });
      continue;
    }

    const res = await gql<{
      metafieldsSet: {
        metafields: { id: string }[] | null;
        userErrors: { field?: string[] | null; message: string }[];
      };
    }>(
      `mutation($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      {
        metafields: [
          {
            ownerId: col.id,
            namespace: NOINDEX_METAFIELD.namespace,
            key: NOINDEX_METAFIELD.key,
            type: NOINDEX_METAFIELD.type,
            value: TARGET_VALUE,
          },
        ],
      }
    );
    assertNoUserErrors(`metafieldsSet ${handle}`, res.metafieldsSet.userErrors);
    log(`      set.`);
    rows.push({ item: `noindex ${handle}`, status: "SET" });
  }
}

async function main() {
  await applyKeepers();
  await removeRicePadding();
  await applyNoindex();
  summary(rows);
}

main().catch((err) => {

  console.error(err);
  process.exit(1);
});

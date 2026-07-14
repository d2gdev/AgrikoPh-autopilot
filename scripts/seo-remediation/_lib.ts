/**
 * Shared helpers for the Agriko SEO/IA remediation scripts.
 *
 * Runs through the app's existing Admin client (`lib/shopify-admin.ts`),
 * which resolves the live token DB-first and auto-refreshes on 401.
 *
 * SAFETY: every script defaults to DRY-RUN. It only mutates when you pass
 * APPLY=1 in the environment. Run order and commands are in README.md.
 *
 *   Preview:  cd /opt/autopilot && npx tsx scripts/seo-remediation/01-redirects.ts
 *   Apply:    cd /opt/autopilot && APPLY=1 npx tsx scripts/seo-remediation/01-redirects.ts
 */
import { shopifyFetch } from "../../lib/shopify-admin";

export const APPLY = process.env.APPLY === "1" || process.env.APPLY === "true";

export function log(...args: unknown[]) {

  console.log(...args);
}

export function banner(title: string) {
  log("\n" + "=".repeat(72));
  log(`${APPLY ? "APPLY" : "DRY-RUN"} — ${title}`);
  log("=".repeat(72));
}

/** Thin pass-through to the app client so scripts have one import surface. */
export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  return shopifyFetch<T>(query, variables);
}

/** Shape every Shopify *userErrors return uses. */
export interface UserError {
  field?: string[] | null;
  message: string;
}

/** Throw if a mutation returned userErrors; otherwise return the payload. */
export function assertNoUserErrors(label: string, errors: UserError[] | undefined | null) {
  if (errors && errors.length) {
    throw new Error(
      `${label} failed:\n` + errors.map((e) => `  - ${(e.field ?? []).join(".")}: ${e.message}`).join("\n")
    );
  }
}

/**
 * Look up an Online Store resource id by handle.
 * type: "PRODUCT" | "COLLECTION" | "BLOG".
 */
export async function idByHandle(
  type: "product" | "collection",
  handle: string
): Promise<{ id: string; title: string } | null> {
  if (type === "product") {
    const d = await gql<{ productByHandle: { id: string; title: string } | null }>(
      `query($h:String!){ productByHandle(handle:$h){ id title } }`,
      { h: handle }
    );
    return d.productByHandle;
  }
  const d = await gql<{ collectionByHandle: { id: string; title: string } | null }>(
    `query($h:String!){ collectionByHandle(handle:$h){ id title } }`,
    { h: handle }
  );
  return d.collectionByHandle;
}

/** Summary printed at the end of every script run. */
export function summary(rows: Array<{ item: string; status: string }>) {
  log("\n--- Summary ---");
  for (const r of rows) log(`  [${r.status}] ${r.item}`);
  if (!APPLY) log("\n(DRY-RUN — re-run with APPLY=1 to make these changes live.)");
}

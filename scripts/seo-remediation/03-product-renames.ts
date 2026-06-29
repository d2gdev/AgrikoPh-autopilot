/**
 * 03-product-renames.ts — Rename Agriko products (title only, handles unchanged).
 *
 * VERIFIED: Shopify Admin GraphQL 2025-01 productUpdate signature:
 *
 *   mutation productUpdate(
 *     product: ProductUpdateInput   ← used here (non-deprecated form)
 *     input:   ProductInput         ← @deprecated, not used
 *     identifier: ProductUpdateIdentifiers
 *     media: [CreateMediaInput!]
 *   ): ProductUpdatePayload
 *
 *   ProductUpdateInput has: id, title, handle, descriptionHtml, seo, status,
 *   tags, vendor, metafields, redirectNewHandle, collectionsToJoin,
 *   collectionsToLeave, …
 *
 * HANDLE PRESERVATION: We pass the existing `handle` explicitly in every
 * mutation so Shopify cannot auto-derive a new handle from the updated title.
 * The mutation response also returns `handle` so we can assert it is unchanged.
 *
 * Usage:
 *   Preview:  cd /opt/autopilot && npx tsx scripts/seo-remediation/03-product-renames.ts
 *   Apply:    cd /opt/autopilot && APPLY=1 npx tsx scripts/seo-remediation/03-product-renames.ts
 */

import {
  APPLY,
  log,
  banner,
  gql,
  assertNoUserErrors,
  idByHandle,
  summary,
  type UserError,
} from "./_lib";
import { RENAMES } from "./_data";

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

interface ProductUpdatePayload {
  productUpdate: {
    product: {
      id: string;
      title: string;
      handle: string;
    } | null;
    userErrors: UserError[];
  };
}

// ---------------------------------------------------------------------------
// Mutation (2025-01 non-deprecated form)
// We pass `handle` explicitly to guarantee it is never auto-regenerated.
// ---------------------------------------------------------------------------
const PRODUCT_UPDATE_MUTATION = /* graphql */ `
  mutation ProductRename($id: ID!, $title: String!, $handle: String!) {
    productUpdate(product: { id: $id, title: $title, handle: $handle }) {
      product {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  banner("03-product-renames — title updates (handles immutable)");

  const rows: Array<{ item: string; status: string }> = [];

  for (const { handle, newTitle } of RENAMES) {
    const product = await idByHandle("product", handle);

    if (!product) {
      log(`  ✗ NOT FOUND   handle="${handle}"`);
      rows.push({ item: handle, status: "NOT FOUND" });
      continue;
    }

    const { id, title: currentTitle } = product;

    if (currentTitle === newTitle) {
      log(`  ✓ SKIP        "${handle}"  (already titled: "${currentTitle}")`);
      rows.push({ item: handle, status: "SKIP (already named)" });
      continue;
    }

    log(`  → "${handle}"`);
    log(`      current : "${currentTitle}"`);
    log(`      new     : "${newTitle}"`);

    if (!APPLY) {
      rows.push({ item: handle, status: "DRY-RUN (would rename)" });
      continue;
    }

    const result = await gql<ProductUpdatePayload>(PRODUCT_UPDATE_MUTATION, {
      id,
      title: newTitle,
      handle, // passed explicitly — must not change
    });

    assertNoUserErrors(`productUpdate(${handle})`, result.productUpdate.userErrors);

    const updated = result.productUpdate.product;
    if (!updated) {
      throw new Error(`productUpdate(${handle}) returned null product with no userErrors`);
    }

    // Hard assertion: handle must be identical after the mutation.
    if (updated.handle !== handle) {
      throw new Error(
        `HANDLE CHANGED for "${handle}" → "${updated.handle}". Aborting — investigate immediately.`
      );
    }

    log(`      ✓ renamed. handle still: "${updated.handle}"`);
    rows.push({ item: handle, status: `RENAMED → "${newTitle}"` });
  }

  summary(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

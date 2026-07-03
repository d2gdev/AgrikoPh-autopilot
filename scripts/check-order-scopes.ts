// scripts/check-order-scopes.ts — Phase 4 gate: the client-credentials token must
// carry read_orders (or read_all_orders) before any orders work proceeds.
// Run: npx tsx scripts/check-order-scopes.ts
import { shopifyFetch } from "../lib/shopify-admin";

// Wrapped in main() rather than using top-level await: this repo's tsx/esbuild
// config emits CJS, which doesn't support top-level await (matches the
// async-main() convention used by the other scripts/*.ts files).
async function main() {
  const data = await shopifyFetch<{
    currentAppInstallation: { accessScopes: Array<{ handle: string }> };
  }>(`query AccessScopeList { currentAppInstallation { accessScopes { handle } } }`);

  const scopes = data.currentAppInstallation.accessScopes.map((s) => s.handle);
  console.log("Granted scopes:", scopes.join(", "));

  if (scopes.includes("read_orders") || scopes.includes("read_all_orders")) {
    console.log("✓ read_orders present — Phase 4 may proceed");
  } else {
    console.error("✗ read_orders MISSING. STOP Phase 4. Operator action needed:");
    console.error("  Shopify admin → Settings → Apps and sales channels → Develop apps →");
    console.error("  [this app] → Configuration → Admin API integration → add read_orders scope,");
    console.error("  save, then re-mint the token (next shopifyFetch 401-refresh picks it up).");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[check-order-scopes] Failed:", e);
  process.exit(1);
});

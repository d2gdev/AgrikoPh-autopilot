# Task 1 Report — Shopify governed-resource adapter

## Status

DONE

## Files

- Created `lib/shopify-governed-resources.ts`
- Modified `lib/shopify-admin.ts`
- Created `__tests__/lib/shopify-governed-resources.test.ts`
- Modified `__tests__/lib/shopify-admin.test.ts`

## Red evidence

`npx vitest run __tests__/lib/shopify-governed-resources.test.ts` exited 1 with `Cannot find package '@/lib/shopify-governed-resources'`, confirming the new interface was absent.

## Green evidence

`npx vitest run __tests__/lib/shopify-governed-resources.test.ts __tests__/lib/shopify-admin.test.ts` passed: 2 files, 25 tests.

## Additional verification

- `npm run typecheck`: passed (`tsc --noEmit`, exit 0)
- `git diff --check`: passed
- No Shopify request occurred outside mocks in the focused adapter/admin tests.

## Commit

`2aa7f992a2a0bc9f0bb2191c5715edb0719f6f37`

## Concerns

None. No production, deployment, database, Shopify live-write, or authorization action was performed.

## Review fixes

- Product and collection mutations now reject `title` before transport and expose no content-title input.
- Unsupported runtime resource types now fail closed instead of falling through to page mutation.
- Page titles longer than 70 characters are rejected before transport.
- State-hash coverage independently proves changes for title, body HTML, and SEO.

### Review red evidence

The focused two-file run failed 4 tests: product-title rejection, collection-title rejection, unsupported-type rejection, and overlong page-title validation. Each failure showed the request continuing past the required pre-transport boundary.

### Review green evidence

- `npx vitest run __tests__/lib/shopify-governed-resources.test.ts __tests__/lib/shopify-admin.test.ts`: 28/28 passed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.
- Review-fix commit: `8756d948ce8ba3fb940c3d6c9a79a95e22a5565f`.

## Important finding fix

Product and collection helpers now reject every caller-owned content key except `descriptionHtml`, reject nested SEO keys except `title` and `description`, and explicitly construct Shopify variables from `id`, a newly constructed SEO object, and optional `descriptionHtml`. No caller-owned object is spread or passed through.

### Important finding red evidence

- Direct helper tests with forged `handle`, `status`, `price`, and content `title` produced 5 failures because those keys reached transport.
- A second red cycle with forged nested SEO `status` produced 2 failures because the SEO object reached transport.

### Important finding green evidence

- `npx vitest run __tests__/lib/shopify-governed-resources.test.ts __tests__/lib/shopify-admin.test.ts`: 36/36 passed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.
- Commit: `76b7e4608e5030703ed3edc6adc036d719c20ea2`.

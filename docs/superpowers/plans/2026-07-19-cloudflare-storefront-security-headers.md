# Cloudflare Storefront Security Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved Referrer-Policy and Permissions-Policy headers to `agrikoph.com` at the Cloudflare edge without restricting checkout, media playback, or other storefront capabilities.

**Architecture:** Use one zone-level Cloudflare Response Header Transform Rule scoped only to the storefront hostname. Establish a failing HTTP-header check first, apply two static response headers, then verify representative HTML, text, and asset responses independently from the Shopify theme deployment.

**Tech Stack:** Cloudflare Response Header Transform Rules, Node.js 20, native `fetch`, Node test runner, curl.

## Global Constraints

- Set `Referrer-Policy` to exactly `strict-origin-when-cross-origin`.
- Set `Permissions-Policy` to exactly `camera=(), microphone=(), geolocation=()`.
- Do not restrict `payment`, `fullscreen`, `autoplay`, or unrelated browser capabilities.
- Scope the rule to `http.host eq "agrikoph.com"`; do not affect Shopify Admin, checkout hostnames, or Autopilot.
- Treat the Cloudflare rule as an independent change with an independent rollback.
- Do not report completion until the authenticated audit item, live headers, and persisted evidence have each been reviewed.

---

### Task 1: Add a deterministic live-header verifier

**Files:**
- Create: `scripts/verify-storefront-security-headers.mjs`
- Modify: `package.json`
- Test: live `agrikoph.com` responses

**Interfaces:**
- Consumes: `SECURITY_HEADER_BASE_URL`, defaulting to `https://agrikoph.com`.
- Produces: nonzero exit on any missing/mismatched header and JSON evidence on success.

- [ ] **Step 1: Create the verifier**

```js
const base = (process.env.SECURITY_HEADER_BASE_URL || 'https://agrikoph.com').replace(/\/$/, '');
const targets = [
  '/',
  '/robots.txt',
  '/blogs/news',
  '/blogs/recipes',
];

const expected = {
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

const results = [];
for (const path of targets) {
  const response = await fetch(`${base}${path}`, {
    method: 'GET',
    redirect: 'manual',
    headers: { 'user-agent': 'AgrikoSecurityHeaderVerifier/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  const observed = Object.fromEntries(
    Object.keys(expected).map((name) => [name, response.headers.get(name)]),
  );
  results.push({ path, status: response.status, observed });
  for (const [name, value] of Object.entries(expected)) {
    if (observed[name] !== value) {
      throw new Error(`${path}: ${name} expected "${value}", got "${observed[name]}"`);
    }
  }
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  base,
  expected,
  results,
}, null, 2));
```

Add this package script:

```json
"verify:storefront-security-headers": "node scripts/verify-storefront-security-headers.mjs"
```

- [ ] **Step 2: Run it to establish the failing baseline**

Run: `npm run verify:storefront-security-headers`

Expected: FAIL on `/` because one or both approved headers are absent.

- [ ] **Step 3: Commit the verifier**

```bash
git add package.json scripts/verify-storefront-security-headers.mjs
git commit -m "test: verify storefront security headers"
```

### Task 2: Create one Cloudflare response-header transform rule

**Files:**
- No repository source changes.
- External configuration: Cloudflare zone `agrikoph.com`, phase `http_response_headers_transform`.

**Interfaces:**
- Consumes: Cloudflare zone access with Transform Rules permission.
- Produces: one reversible rule named `Agriko storefront security headers`.

- [ ] **Step 1: Open the exact Cloudflare configuration surface**

In the Cloudflare dashboard:

```text
agrikoph.com
Rules
Transform Rules
Modify Response Header
Create rule
```

Cloudflare documents that Response Header Transform Rules can add or overwrite response headers and are available on all plans:
`https://developers.cloudflare.com/rules/transform/response-header-modification/`

- [ ] **Step 2: Configure the hostname expression**

Set:

```text
Rule name: Agriko storefront security headers
Custom filter expression: (http.host eq "agrikoph.com")
```

- [ ] **Step 3: Configure the two Set static operations**

Add exactly:

```text
Header name: Referrer-Policy
Operation: Set static
Value: strict-origin-when-cross-origin
```

and:

```text
Header name: Permissions-Policy
Operation: Set static
Value: camera=(), microphone=(), geolocation=()
```

Do not enable Cloudflare's broader managed “Add security headers” transform because its `Referrer-Policy: same-origin` value does not match the approved design and it adds unrelated legacy headers.

- [ ] **Step 4: Save without changing rule order elsewhere**

Save the rule after existing managed transforms. Confirm no later response-header rule overwrites either header; Cloudflare evaluates these rules in order and later rules win.

### Task 3: Verify headers and storefront compatibility

**Files:**
- No source changes.
- Persist results in the authenticated audit evidence record.

**Interfaces:**
- Consumes: enabled Cloudflare transform rule.
- Produces: exact header evidence plus basic storefront compatibility evidence.

- [ ] **Step 1: Run the deterministic verifier**

Run: `npm run verify:storefront-security-headers`

Expected: PASS for `/`, `/robots.txt`, `/blogs/news`, and `/blogs/recipes`.

- [ ] **Step 2: Confirm header casing and duplicate behavior**

Run:

```bash
curl -sSI https://agrikoph.com/ | rg -i '^(referrer-policy|permissions-policy):'
```

Expected exactly two lines total, one per header. There must not be competing duplicate values.

- [ ] **Step 3: Check critical browser behavior**

At 390 px and 1440 px, load the homepage and verify:

```text
hero poster visible
desktop video can play/pause at 1440 px
product cards render
cart drawer opens
checkout link can be followed to Shopify checkout
no camera/microphone/geolocation permission is requested by the storefront
no new Permissions-Policy console warning caused by the rule
```

The rule is scoped to `agrikoph.com`, so the Shopify checkout hostname must not inherit it.

- [ ] **Step 4: Use Cloudflare Trace if any path fails**

Trace the failing URL and confirm the rule appears in `http_response_headers_transform`. If a later rule overwrites it, move `Agriko storefront security headers` after that rule and rerun Steps 1-3.

### Task 4: Record authenticated evidence and rollback data

**Files:**
- Update: `.mex/ROUTER.md` only if operational ownership changed.
- Update the relevant `.mex/context/` file if Cloudflare header ownership was previously undocumented.

**Interfaces:**
- Consumes: authenticated technical-audit item and Cloudflare rule metadata.
- Produces: traceable evidence and an exact rollback instruction.

- [ ] **Step 1: Record the rule evidence**

Record:

```text
Cloudflare zone
rule name
rule expression
two header operations
rule created/updated timestamp
verifier JSON timestamp
representative response statuses
authenticated audit item ID
```

- [ ] **Step 2: Record rollback**

Rollback is:

```text
Cloudflare → agrikoph.com → Rules → Transform Rules
Disable “Agriko storefront security headers”
Run npm run verify:storefront-security-headers and confirm the expected baseline failure
```

- [ ] **Step 3: Run GROW**

Update the smallest relevant operational context with the fact that storefront security response headers are owned at Cloudflare, not in Shopify Liquid. Run `mex log` only if the ownership decision is not already captured.

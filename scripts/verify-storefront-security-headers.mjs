const base = (process.env.SECURITY_HEADER_BASE_URL || 'https://agrikoph.com').replace(/\/$/, '');
const targets = ['/', '/robots.txt', '/blogs/news', '/blogs/recipes'];

const expected = {
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

const results = [];
for (const path of targets) {
  const response = await fetch(`${base}${path}`, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'user-agent': 'AgrikoSecurityHeaderVerifier/1.0',
    },
    signal: AbortSignal.timeout(20_000),
  });

  const observed = Object.fromEntries(Object.keys(expected).map((name) => [name, response.headers.get(name)]));
  results.push({ path, status: response.status, observed });

  for (const [name, value] of Object.entries(expected)) {
    if (observed[name] !== value) {
      throw new Error(`${path}: ${name} expected "${value}", got "${observed[name]}"`);
    }
  }
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      base,
      expected,
      results,
    },
    null,
    2,
  ),
);

// NOTE: This is an in-process rate limiter. In Vercel serverless, each cold start
// gets a fresh Map — no cross-request state is shared between invocations.
// This provides burst protection within a single warm instance only.
// For cross-request rate limiting in production, replace with Vercel KV or Upstash Redis.

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function sweepExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  // Sweep when map grows large to prevent unbounded accumulation
  if (buckets.size > 1000) sweepExpired(now);

  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

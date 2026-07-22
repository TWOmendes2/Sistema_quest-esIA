import 'server-only';

type Bucket = {
  count: number;
  resetAt: number;
  blockedUntil?: number;
};

type RateLimitOptions = {
  key: string;
  limit: number;
  windowSeconds: number;
  blockSeconds?: number;
};

const buckets = new Map<string, Bucket>();

export function checkRateLimit(options: RateLimitOptions): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  const windowMs = options.windowSeconds * 1000;
  const blockMs = (options.blockSeconds ?? options.windowSeconds) * 1000;
  const current = buckets.get(options.key);

  if (current?.blockedUntil && current.blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((current.blockedUntil - now) / 1000) };
  }

  if (!current || current.resetAt <= now) {
    buckets.set(options.key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  current.count += 1;

  if (current.count > options.limit) {
    current.blockedUntil = now + blockMs;
    buckets.set(options.key, current);
    return { allowed: false, retryAfterSeconds: Math.ceil(blockMs / 1000) };
  }

  buckets.set(options.key, current);
  return { allowed: true };
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

// App-level rate limiter for the public judge endpoint. Two fixed windows:
// a per-client layer (keyed on client IP) and a per-instance global layer
// that bounds distributed-IP abuse. Complements — never replaces — the Cloud
// Run static ceiling (max-instances=2 / concurrency=8 / timeout=180) and the
// billing alert from G4.
//
// Instance-local state, same tradeoff as the checkDomainAge cache: wiped on
// cold start, not shared across scaled instances. With max-instances=2 the
// effective fleet-wide limit is at worst 2× the nominal values below.

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export type RateLimiterConfig = {
  windowMs: number;
  perClientLimit: number;
  globalLimit: number;
  maxTrackedClients: number;
};

export type RateLimiter = {
  check(clientKey: string, now?: number): RateLimitDecision;
  size(): number;
};

// Tunable. One judgment takes 15–25s of Gemini + tool time, so a human demo
// user physically issues ≤4/min — 6 leaves retry headroom while blocking
// scripted loops. The global ceiling sits just below instance saturation
// (concurrency 8 × 15–25s ≈ 19–32 completions/min) so Gemini spend is bounded
// even from many distinct IPs. maxTrackedClients bounds the map to tens of KB.
export const JUDGE_RATE_LIMIT: RateLimiterConfig = {
  windowMs: 60_000,
  perClientLimit: 6,
  globalLimit: 20,
  maxTrackedClients: 1000,
};

type Entry = { count: number; windowStart: number };

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const clients = new Map<string, Entry>();
  let global: Entry = { count: 0, windowStart: 0 };

  const expired = (entry: Entry, now: number): boolean =>
    entry.windowStart + config.windowMs <= now;

  const retryAfterSeconds = (entry: Entry, now: number): number =>
    Math.max(1, Math.ceil((entry.windowStart + config.windowMs - now) / 1000));

  // Called only when the map is at capacity. Sweeping expired entries almost
  // always frees room (every entry expires within one window). The
  // oldest-window fallback below can in the pathological all-live case evict
  // a key that is mid-window — acceptable: the global layer still bounds
  // total spend, and reaching 1000 live clients inside one minute means the
  // global limit already rejected most of them.
  function evictForInsert(now: number): void {
    for (const [key, entry] of clients) {
      if (expired(entry, now)) clients.delete(key);
    }
    if (clients.size < config.maxTrackedClients) return;
    let oldestKey: string | null = null;
    let oldestStart = Infinity;
    for (const [key, entry] of clients) {
      if (entry.windowStart < oldestStart) {
        oldestStart = entry.windowStart;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) clients.delete(oldestKey);
  }

  function check(clientKey: string, now: number = Date.now()): RateLimitDecision {
    if (expired(global, now)) {
      global = { count: 0, windowStart: now };
    }
    let entry = clients.get(clientKey);
    if (entry && expired(entry, now)) {
      clients.delete(clientKey);
      entry = undefined;
    }

    // Denials consume neither counter: a global-layer rejection must not burn
    // an innocent client's budget, and a per-client rejection must not eat
    // into the global budget available to others.
    if (global.count >= config.globalLimit) {
      return { allowed: false, retryAfterSeconds: retryAfterSeconds(global, now) };
    }
    if (entry && entry.count >= config.perClientLimit) {
      return { allowed: false, retryAfterSeconds: retryAfterSeconds(entry, now) };
    }

    if (!entry) {
      if (clients.size >= config.maxTrackedClients) evictForInsert(now);
      entry = { count: 0, windowStart: now };
      clients.set(clientKey, entry);
    }
    entry.count += 1;
    global.count += 1;
    return { allowed: true };
  }

  return { check, size: () => clients.size };
}

// Module singleton used by the judge route. The indirection (instead of
// exporting the limiter directly) lets tests reset state without relying on
// live-binding reassignment semantics.
let judgeLimiterInstance = createRateLimiter(JUDGE_RATE_LIMIT);

export const judgeRateLimiter: RateLimiter = {
  check: (clientKey, now) => judgeLimiterInstance.check(clientKey, now),
  size: () => judgeLimiterInstance.size(),
};

export function __resetJudgeRateLimiterForTests(): void {
  judgeLimiterInstance = createRateLimiter(JUDGE_RATE_LIMIT);
}

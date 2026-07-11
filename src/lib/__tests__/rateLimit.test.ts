import { describe, expect, it } from "vitest";
import { createRateLimiter, JUDGE_RATE_LIMIT } from "../rateLimit";

// Small config so tests don't loop hundreds of times. The JUDGE_RATE_LIMIT
// constants are covered by a shape test only — their values are tuning, not
// behavior.
const CONFIG = {
  windowMs: 60_000,
  perClientLimit: 3,
  globalLimit: 5,
  maxTrackedClients: 4,
};

const T0 = 1_000_000;

describe("createRateLimiter", () => {
  it("allows up to perClientLimit requests in a window, then denies with a bounded Retry-After", () => {
    const limiter = createRateLimiter(CONFIG);
    for (let i = 0; i < CONFIG.perClientLimit; i++) {
      expect(limiter.check("a", T0 + i)).toEqual({ allowed: true });
    }
    const denied = limiter.check("a", T0 + CONFIG.perClientLimit);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("allows the same client again once its window has elapsed", () => {
    const limiter = createRateLimiter(CONFIG);
    for (let i = 0; i < CONFIG.perClientLimit; i++) {
      limiter.check("a", T0);
    }
    expect(limiter.check("a", T0).allowed).toBe(false);
    expect(limiter.check("a", T0 + CONFIG.windowMs).allowed).toBe(true);
  });

  it("isolates clients: one limited key does not affect another", () => {
    const limiter = createRateLimiter(CONFIG);
    for (let i = 0; i < CONFIG.perClientLimit; i++) {
      limiter.check("a", T0);
    }
    expect(limiter.check("a", T0).allowed).toBe(false);
    expect(limiter.check("b", T0).allowed).toBe(true);
  });

  it("enforces the per-instance global ceiling across distinct clients", () => {
    const limiter = createRateLimiter(CONFIG);
    // globalLimit=5, perClientLimit=3 → two clients can exhaust the global
    // layer without either hitting its own limit.
    for (let i = 0; i < 3; i++) expect(limiter.check("a", T0).allowed).toBe(true);
    for (let i = 0; i < 2; i++) expect(limiter.check("b", T0).allowed).toBe(true);
    const denied = limiter.check("c", T0);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
  });

  it("a denial consumes neither counter: a globally-denied client keeps its full budget", () => {
    const limiter = createRateLimiter(CONFIG);
    for (let i = 0; i < 3; i++) limiter.check("a", T0);
    for (let i = 0; i < 2; i++) limiter.check("b", T0);
    // "c" is denied by the global layer only — this must not charge "c".
    expect(limiter.check("c", T0).allowed).toBe(false);
    const t1 = T0 + CONFIG.windowMs;
    for (let i = 0; i < CONFIG.perClientLimit; i++) {
      expect(limiter.check("c", t1 + i).allowed).toBe(true);
    }
  });

  it("per-client denial does not consume the global counter", () => {
    const limiter = createRateLimiter(CONFIG);
    for (let i = 0; i < 3; i++) limiter.check("a", T0);
    // Denied per-client; must not eat into the global budget of 5.
    expect(limiter.check("a", T0).allowed).toBe(false);
    expect(limiter.check("a", T0).allowed).toBe(false);
    // Global has 5-3=2 left — both must still be grantable.
    expect(limiter.check("b", T0).allowed).toBe(true);
    expect(limiter.check("c", T0).allowed).toBe(true);
  });

  it("bounds tracked clients: expired entries are swept and size never exceeds maxTrackedClients", () => {
    const limiter = createRateLimiter({ ...CONFIG, globalLimit: 1_000 });
    // Fill across many expired windows: each batch of distinct keys lands in
    // its own window, so earlier batches are sweepable when later ones insert.
    for (let batch = 0; batch < 3; batch++) {
      const t = T0 + batch * CONFIG.windowMs;
      for (let i = 0; i < CONFIG.maxTrackedClients; i++) {
        limiter.check(`k${batch}-${i}`, t);
      }
      expect(limiter.size()).toBeLessThanOrEqual(CONFIG.maxTrackedClients);
    }
  });

  it("a still-live key's count survives a sweep of expired entries", () => {
    const limiter = createRateLimiter({ ...CONFIG, globalLimit: 1_000 });
    // Fill the map with keys that will be expired one window later.
    for (let i = 0; i < CONFIG.maxTrackedClients; i++) {
      limiter.check(`stale-${i}`, T0);
    }
    const t1 = T0 + CONFIG.windowMs;
    // Inserting "live" forces a sweep (map is at capacity); the sweep removes
    // the stale entries, and "live" then accumulates to its limit.
    for (let i = 0; i < CONFIG.perClientLimit; i++) {
      expect(limiter.check("live", t1).allowed).toBe(true);
    }
    // A further insert in the same window must not disturb the live count.
    limiter.check("other", t1);
    expect(limiter.check("live", t1 + 1).allowed).toBe(false);
  });
});

describe("JUDGE_RATE_LIMIT", () => {
  it("has sane relations: per-client < global, one-minute window", () => {
    expect(JUDGE_RATE_LIMIT.windowMs).toBe(60_000);
    expect(JUDGE_RATE_LIMIT.perClientLimit).toBeLessThan(
      JUDGE_RATE_LIMIT.globalLimit,
    );
    expect(JUDGE_RATE_LIMIT.maxTrackedClients).toBeGreaterThan(0);
  });
});

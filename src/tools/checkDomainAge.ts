// RDAP lookup via rdap.org (universal proxy). Domain age in days from the
// registration event. SSRF guard: the fetch target is hardcoded rdap.org;
// only a validated domain string lands in the path.

const RDAP_BASE = "https://rdap.org/domain/";
const DEFAULT_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Domain validation: lowercase letters, digits, hyphens (not at edges),
// dot-separated labels, at least one dot. Rejects anything with path,
// scheme, query, or whitespace.
const DOMAIN_REGEX =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export type CheckDomainAgeResult =
  | { ok: true; domain: string; registeredAt: string; ageDays: number }
  | { ok: false; reason: string };

// Instance-local cache. Wiped on Cloud Run cold start and not shared across
// scaled instances. Future upgrade path: a Firestore-backed cache collection
// for cross-instance consistency.
type CacheEntry = {
  value: CheckDomainAgeResult & { ok: true };
  expiresAt: number;
};
const cache = new Map<string, CacheEntry>();

export function __clearCacheForTests(): void {
  cache.clear();
}

export async function checkDomainAge(args: {
  domain: string;
  timeoutMs?: number;
}): Promise<CheckDomainAgeResult> {
  const domain = args.domain?.trim().toLowerCase() ?? "";
  if (!domain || !DOMAIN_REGEX.test(domain)) {
    return { ok: false, reason: "invalid_domain" };
  }

  const cached = cache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await fetch(
      `${RDAP_BASE}${encodeURIComponent(domain)}`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      return { ok: false, reason: `http_${response.status}` };
    }
    const data = (await response.json()) as {
      events?: Array<{ eventAction?: string; eventDate?: string }>;
    };
    const event = data.events?.find((e) => e.eventAction === "registration");
    if (!event?.eventDate) {
      return { ok: false, reason: "no_registration_event" };
    }
    const registered = new Date(event.eventDate);
    if (Number.isNaN(registered.getTime())) {
      return { ok: false, reason: "invalid_date" };
    }
    const ageDays = Math.floor(
      (Date.now() - registered.getTime()) / ONE_DAY_MS,
    );
    const result: CheckDomainAgeResult & { ok: true } = {
      ok: true,
      domain,
      registeredAt: event.eventDate,
      ageDays,
    };
    cache.set(domain, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

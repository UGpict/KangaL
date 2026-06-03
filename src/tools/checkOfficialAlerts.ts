// Anti-phishing council news feed. SSRF guard: fetch target is hardcoded
// `antiphishing.jp`. Keyword filtering is local — we do not follow any URLs
// returned by the feed.
//
// SECURITY: text returned by this tool is external content (alert titles
// and links). Callers passing the strings to a model must wrap them in an
// <untrusted_input> envelope and treat as DATA, never as instruction.

const ANTI_PHISHING_RSS = "https://www.antiphishing.jp/news/index.rdf";
const DEFAULT_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_MATCHES = 5;

export type AlertMatch = { title: string; link: string };

export type CheckOfficialAlertsResult =
  | { ok: true; matches: AlertMatch[] }
  | { ok: false; reason: string };

// Instance-local cache. Same caveats as checkDomainAge: wiped on cold start,
// not shared across scaled instances.
let cachedItems: { value: AlertMatch[]; expiresAt: number } | null = null;

export function __clearCacheForTests(): void {
  cachedItems = null;
}

const TITLE_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/;
const LINK_REGEX = /<link[^>]*>([\s\S]*?)<\/link>/;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripCdata(s: string): string {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : s;
}

function clean(raw: string): string {
  return decodeXmlEntities(stripCdata(raw).trim());
}

function parseItems(xml: string): AlertMatch[] {
  const items: AlertMatch[] = [];
  for (const itemMatch of xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)) {
    const block = itemMatch[1];
    const title = block.match(TITLE_REGEX)?.[1];
    const link = block.match(LINK_REGEX)?.[1];
    if (title && link) {
      items.push({ title: clean(title), link: clean(link) });
    }
  }
  return items;
}

async function loadItems(timeoutMs: number): Promise<AlertMatch[]> {
  if (cachedItems && cachedItems.expiresAt > Date.now()) {
    return cachedItems.value;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(ANTI_PHISHING_RSS, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }
    const xml = await response.text();
    const items = parseItems(xml);
    cachedItems = { value: items, expiresAt: Date.now() + CACHE_TTL_MS };
    return items;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkOfficialAlerts(args: {
  keywords: string[];
  timeoutMs?: number;
}): Promise<CheckOfficialAlertsResult> {
  const keywords = (args.keywords ?? []).filter(
    (k) => typeof k === "string" && k.trim().length > 0,
  );
  if (keywords.length === 0) {
    return { ok: false, reason: "no_keywords" };
  }
  try {
    const items = await loadItems(args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const matches = items
      .filter((it) => keywords.some((k) => it.title.includes(k)))
      .slice(0, MAX_MATCHES);
    return { ok: true, matches };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, reason };
  }
}

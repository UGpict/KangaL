// Google Web Risk Lookup. We send the user-supplied URL as a query parameter
// to a HARDCODED endpoint — we never fetch the URL ourselves. This is the
// SSRF guard for this tool: hostile inputs cannot turn KangaL into a fetcher
// of attacker-controlled servers.

const WEB_RISK_ENDPOINT = "https://webrisk.googleapis.com/v1/uris:search";
const DEFAULT_TIMEOUT_MS = 5000;
const THREAT_TYPES = [
  "MALWARE",
  "SOCIAL_ENGINEERING",
  "UNWANTED_SOFTWARE",
] as const;

export type CheckUrlReputationResult =
  | { ok: true; url: string; threats: string[] }
  | { ok: false; reason: string };

export async function checkUrlReputation(args: {
  url: string;
  timeoutMs?: number;
}): Promise<CheckUrlReputationResult> {
  const apiKey = process.env.WEB_RISK_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return { ok: false, reason: "missing_api_key" };
  }

  const url = args.url?.trim() ?? "";
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, reason: "invalid_url" };
  }

  const search = new URLSearchParams();
  search.set("uri", url);
  for (const t of THREAT_TYPES) search.append("threatTypes", t);
  search.set("key", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`${WEB_RISK_ENDPOINT}?${search.toString()}`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, reason: `http_${response.status}` };
    }
    const data = (await response.json()) as {
      threat?: { threatTypes?: string[] };
    };
    const threats = data.threat?.threatTypes ?? [];
    return { ok: true, url, threats };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

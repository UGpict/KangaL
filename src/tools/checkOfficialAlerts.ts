// Static snapshot of anti-phishing-council-style alerts. We deliberately
// avoid live RSS fetching:
//   - antiphishing.jp does not expose the URL we previously assumed (was
//     404), and live scraping is fragile for a hackathon demo;
//   - deterministic data keeps the demo reproducible (no flakiness from
//     network or rate limits);
//   - the SSRF surface shrinks to zero (no outbound calls at all).
// Refresh path: edit src/data/officialAlerts.json and bump snapshotDate.
// All institution names in the snapshot are fictional (CLAUDE.md).
import rawAlerts from "@/data/officialAlerts.json";

type AlertRecord = {
  id: string;
  title: string;
  category: string;
  date: string;
};

type AlertsFile = {
  snapshotDate: string;
  source: string;
  alerts: AlertRecord[];
};

const SNAPSHOT: AlertsFile = rawAlerts as AlertsFile;
const MAX_MATCHES = 5;

// Field name kept as `url` to match OfficialAlertMatch in
// types/investigation.ts. The value is a `snapshot://` pseudo-URL — see
// syntheticUrl() — not a navigable http(s) URL.
export type AlertMatch = { title: string; url: string };

export type CheckOfficialAlertsResult =
  | { ok: true; matches: AlertMatch[] }
  | { ok: false; reason: string };

// Stable synthetic URL so the AlertMatch shape stays satisfied. UI can
// surface this as "snapshot://..." rather than render it as a real URL.
function syntheticUrl(id: string): string {
  return `snapshot://officialAlerts/${id}`;
}

export async function checkOfficialAlerts(args: {
  keywords: string[];
}): Promise<CheckOfficialAlertsResult> {
  const keywords = (args.keywords ?? []).filter(
    (k) => typeof k === "string" && k.trim().length > 0,
  );
  if (keywords.length === 0) {
    return { ok: false, reason: "no_keywords" };
  }
  const matches: AlertMatch[] = [];
  for (const alert of SNAPSHOT.alerts) {
    if (keywords.some((k) => alert.title.includes(k))) {
      matches.push({
        title: alert.title,
        url: syntheticUrl(alert.id),
      });
      if (matches.length >= MAX_MATCHES) break;
    }
  }
  return { ok: true, matches };
}

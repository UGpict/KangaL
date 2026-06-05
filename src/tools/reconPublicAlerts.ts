// Attack-side reconnaissance. Surfaces the most recent public-alert trends so
// the attack agent (generateAttackPattern, Task 7-C) can seed a fictional
// sourceContext and bias lever selection toward currently-active archetypes.
//
// SSRF-zero by design: this reads the same static snapshot as
// checkOfficialAlerts (src/data/officialAlerts.json) and performs NO live
// network I/O. The "ライブ取得なし" decision (see checkOfficialAlerts header:
// antiphishing.jp 404 + reproducibility + zero SSRF surface) applies here too.
// The fetcher is injectable purely so tests can swap the source and an
// INTEGRATION smoke can exercise the real snapshot read — not to open a
// network path.
//
// Untrusted-data note: the returned `title` strings originate from an external
// alert corpus. They are DATA, not instructions. The caller
// (generateAttackPattern) is responsible for wrapping them in <untrusted_input>
// before feeding them to Gemini — reconPublicAlerts does not wrap here because
// it has no model boundary of its own.
import rawAlerts from "@/data/officialAlerts.json";

export type AlertTrend = {
  id: string;
  title: string;
  category: string;
  date: string;
};

type AlertsFile = {
  snapshotDate: string;
  source: string;
  alerts: AlertTrend[];
};

// Fetcher boundary. Returns raw alert records; reconPublicAlerts owns the
// sort/cap/shape. Default reads the bundled snapshot (no network).
export type AlertFetcher = () => Promise<AlertTrend[]>;

export type ReconResult =
  | { ok: true; trends: AlertTrend[] }
  | { ok: false; reason: string };

const MAX_TRENDS = 5;

const defaultFetcher: AlertFetcher = async () => {
  const file = rawAlerts as AlertsFile;
  return file.alerts;
};

export async function reconPublicAlerts(
  fetcher: AlertFetcher = defaultFetcher,
): Promise<ReconResult> {
  let records: AlertTrend[];
  try {
    records = await fetcher();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, reason };
  }

  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, reason: "no_alerts" };
  }

  // ISO date strings (YYYY-MM-DD) sort lexicographically === chronologically.
  // Descending = newest first.
  const trends = [...records]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_TRENDS)
    .map(({ id, title, category, date }) => ({ id, title, category, date }));

  return { ok: true, trends };
}

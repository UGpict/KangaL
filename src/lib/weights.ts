import type { AttackPattern } from "@/types/attackPattern";
import type {
  BonusItem,
  InvestigationBonus,
  InvestigationReport,
} from "@/types/investigation";

export type LeverKey = keyof AttackPattern["levers"];

// Tunable. These are UNCALIBRATED initial values. Re-tune after benign-sample
// collection (Task 5). isolation weighted heaviest per §5 ("単独で強い赤信号"),
// personalization next per §5 ("差別化の核心").
export const LEVER_WEIGHTS: Record<LeverKey, number> = {
  urgency: 2,
  authority: 2,
  incentive: 2,
  callToAction: 3,
  personalization: 3,
  isolation: 5,
};

export const CTA_DANGER: Record<
  AttackPattern["levers"]["callToAction"]["action"],
  number
> = {
  transfer_money: 3,
  input_credentials: 3,
  install_app: 2,
  scan_qr: 2,
  click_link: 2,
  call_number: 1,
};

// friction = "high" usually marks benign messages (clunky link, extra
// confirmation steps). It is NOT a hard signal of safety though — sophisticated
// social engineering can deliberately use high friction (multi-step trust
// building) to appear legitimate. Re-evaluate this in Task 5 against real
// benign + scam samples before treating high friction as a free pass.
export const FRICTION_ADJ: Record<
  AttackPattern["levers"]["callToAction"]["friction"],
  number
> = {
  low: 0,
  mid: -1,
  high: -2,
};

export const PERSONALIZATION_LEVEL_RANK: Record<
  AttackPattern["levers"]["personalization"]["level"],
  number
> = {
  broadcast: 0,
  segmented: 1,
  targeted: 2,
};

// §5: "isolation は単独で強い赤信号". A pure linear weighted sum cannot express
// "single lever sufficient to flag" — each lever contributes at most
// weight/Σweights. The floor below pulls the score up to the §5 intent when
// isolation alone is moderate or strong. UNCALIBRATED initial values.
export const ISOLATION_FLOORS: Record<0 | 1 | 2 | 3, number> = {
  0: 0,
  1: 0,
  2: 55,
  3: 75,
};

// Computed at runtime so 0-100 normalization stays in sync with any weight tweak.
export function maxRawScore(): number {
  return (
    3 * Object.values(LEVER_WEIGHTS).reduce((sum, w) => sum + w, 0)
  );
}

// ── Investigation bonus (Chunk 4) ───────────────────────────────────────
//
// Per-signal point values when an investigation tool surfaces a danger
// indicator. All values are ADD-ONLY: a clean investigation (domain old,
// SPF/DKIM/DMARC all pass, Web Risk clear) does NOT subtract from the
// lever-only score. This is intentional — we'd rather miss a benign signal
// than false-negative a real scam. Calibration with real corpora may
// revisit this asymmetry later.
export const BONUS_WEB_RISK_THREAT = 15;
export const BONUS_DOMAIN_YOUNG = 10;
export const BONUS_DOMAIN_AGE_DAYS_THRESHOLD = 7;
export const BONUS_SENDER_AUTH_FAIL = 8;
export const BONUS_KNOWN_SCAM_PER_MATCH = 5;
export const BONUS_KNOWN_SCAM_CAP = 15;
export const BONUS_OFFICIAL_ALERT = 8;
// Sum of individual signals can reach 56 in theory; we clamp the total
// contribution to keep "two strong signals = ceiling" as an intentional
// engineering choice. Raising this cap restores additive behavior.
export const INVESTIGATION_BONUS_CAP = 25;

export function computeInvestigationBonus(
  report: InvestigationReport | null | undefined,
): InvestigationBonus {
  if (!report) return { items: [], total: 0, capped: false };

  const items: BonusItem[] = [];

  if (
    report.urlReputation?.status === "ok" &&
    (report.urlReputation.threats?.length ?? 0) > 0
  ) {
    items.push({ source: "webRisk", points: BONUS_WEB_RISK_THREAT });
  }

  if (
    report.domainAge?.status === "ok" &&
    typeof report.domainAge.ageDays === "number" &&
    report.domainAge.ageDays < BONUS_DOMAIN_AGE_DAYS_THRESHOLD
  ) {
    items.push({ source: "domainAge", points: BONUS_DOMAIN_YOUNG });
  }

  if (report.senderAuth?.status === "ok") {
    const { spf, dkim, dmarc } = report.senderAuth;
    if (spf === "fail" || dkim === "fail" || dmarc === "fail") {
      items.push({ source: "senderAuth", points: BONUS_SENDER_AUTH_FAIL });
    }
  }

  if (
    report.knownScams?.status === "ok" &&
    (report.knownScams.matches?.length ?? 0) > 0
  ) {
    const matchCount = report.knownScams.matches!.length;
    const points = Math.min(
      BONUS_KNOWN_SCAM_CAP,
      matchCount * BONUS_KNOWN_SCAM_PER_MATCH,
    );
    items.push({ source: "knownScams", points });
  }

  if (
    report.officialAlerts?.status === "ok" &&
    (report.officialAlerts.matches?.length ?? 0) > 0
  ) {
    items.push({ source: "officialAlerts", points: BONUS_OFFICIAL_ALERT });
  }

  const rawTotal = items.reduce((sum, it) => sum + it.points, 0);
  const total = Math.min(INVESTIGATION_BONUS_CAP, rawTotal);
  return { items, total, capped: rawTotal > INVESTIGATION_BONUS_CAP };
}

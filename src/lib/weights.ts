import type { AttackPattern } from "@/types/attackPattern";

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

import type { AttackPattern, Sample } from "@/types/attackPattern";

export const DEFAULT_DETECTION_THRESHOLD = 70;
const MIN_THRESHOLD = 0;
const MAX_THRESHOLD = 100;

// Returns the configured detection threshold from KANGAL_DETECTION_THRESHOLD.
// Guards against the Number("") === 0 footgun (empty/whitespace env var would
// otherwise silently become "flag everything"), and clamps to [0, 100] so an
// out-of-range value (e.g. 150 = "flag nothing") cannot pass through silently.
export function getDetectionThreshold(): number {
  const raw = process.env.KANGAL_DETECTION_THRESHOLD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_DETECTION_THRESHOLD;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DETECTION_THRESHOLD;
  if (n < MIN_THRESHOLD || n > MAX_THRESHOLD) return DEFAULT_DETECTION_THRESHOLD;
  return n;
}

export type Judged = { kind: "scam" | "benign"; score: number };

// `null` instead of 0 when the denominator is empty — keeps "no detection
// possible" distinguishable from "0% detection". Caller (UI) renders null as
// an em-dash; computing 0 in that case would lie.
export type Ratio = number | null;

export function recall(judged: Judged[], threshold: number): Ratio {
  const scams = judged.filter((j) => j.kind === "scam");
  if (scams.length === 0) return null;
  const detected = scams.filter((j) => j.score >= threshold).length;
  return detected / scams.length;
}

export function fpr(judged: Judged[], threshold: number): Ratio {
  const benigns = judged.filter((j) => j.kind === "benign");
  if (benigns.length === 0) return null;
  const flagged = benigns.filter((j) => j.score >= threshold).length;
  return flagged / benigns.length;
}

export function coverage(
  patterns: AttackPattern[],
): { detected: number; total: number; ratio: Ratio } {
  const total = patterns.length;
  if (total === 0) return { detected: 0, total: 0, ratio: null };
  const detected = patterns.filter(
    (p) => p.detectionResult?.detected === true,
  ).length;
  return { detected, total, ratio: detected / total };
}

export type EvaluationResult = {
  recall: Ratio;
  fpr: Ratio;
  total: number;
  scamTotal: number;
  benignTotal: number;
};

export async function evaluateSamples(
  samples: Sample[],
  judgeFn: (sample: Sample) => Promise<{ score: number }>,
  threshold: number,
): Promise<EvaluationResult> {
  const judged: Judged[] = await Promise.all(
    samples.map(async (s) => ({
      kind: s.kind,
      score: (await judgeFn(s)).score,
    })),
  );
  return {
    recall: recall(judged, threshold),
    fpr: fpr(judged, threshold),
    total: judged.length,
    scamTotal: judged.filter((j) => j.kind === "scam").length,
    benignTotal: judged.filter((j) => j.kind === "benign").length,
  };
}

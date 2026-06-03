import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackPattern, Sample } from "@/types/attackPattern";
import { exampleAttackPattern } from "@/types/__fixtures__/attackPattern.example";
import {
  coverage,
  DEFAULT_DETECTION_THRESHOLD,
  evaluateSamples,
  fpr,
  getDetectionThreshold,
  type Judged,
  recall,
} from "../metrics";

const ENV_KEY = "KANGAL_DETECTION_THRESHOLD";

beforeEach(() => {
  delete process.env[ENV_KEY];
});

describe("recall", () => {
  it("returns the share of scam samples whose score meets the threshold", () => {
    const judged: Judged[] = [
      { kind: "scam", score: 80 },
      { kind: "scam", score: 50 },
      { kind: "scam", score: 90 },
    ];
    expect(recall(judged, 70)).toBe(2 / 3);
  });

  it("counts a score equal to threshold as detected (>= boundary)", () => {
    const judged: Judged[] = [
      { kind: "scam", score: 70 }, // tie → detected
      { kind: "scam", score: 69 }, // missed
    ];
    expect(recall(judged, 70)).toBe(1 / 2);
  });

  it("returns null when there are no scam samples (no denominator)", () => {
    const judged: Judged[] = [
      { kind: "benign", score: 10 },
      { kind: "benign", score: 80 },
    ];
    expect(recall(judged, 70)).toBeNull();
  });

  it("ignores benign samples when computing recall", () => {
    const judged: Judged[] = [
      { kind: "scam", score: 80 },
      { kind: "benign", score: 90 }, // false flag; not counted in recall
    ];
    expect(recall(judged, 70)).toBe(1);
  });
});

describe("fpr", () => {
  it("returns the share of benign samples mistakenly flagged", () => {
    const judged: Judged[] = [
      { kind: "benign", score: 10 },
      { kind: "benign", score: 20 },
      { kind: "benign", score: 80 },
    ];
    expect(fpr(judged, 70)).toBe(1 / 3);
  });

  it("returns null when there are no benign samples (no denominator)", () => {
    const judged: Judged[] = [{ kind: "scam", score: 80 }];
    expect(fpr(judged, 70)).toBeNull();
  });

  it("ignores scam samples when computing FPR", () => {
    const judged: Judged[] = [
      { kind: "scam", score: 90 }, // not counted in FPR
      { kind: "benign", score: 10 },
    ];
    expect(fpr(judged, 70)).toBe(0);
  });
});

describe("coverage", () => {
  function pattern(id: string, detected: boolean | undefined): AttackPattern {
    return {
      ...exampleAttackPattern,
      id,
      detectionResult: detected === undefined ? undefined : { detected },
    };
  }

  it("counts detected over total from detectionResult", () => {
    const result = coverage([
      pattern("p1", true),
      pattern("p2", true),
      pattern("p3", false),
      pattern("p4", true),
    ]);
    expect(result).toEqual({ detected: 3, total: 4, ratio: 0.75 });
  });

  it("treats missing detectionResult as not detected", () => {
    const result = coverage([
      pattern("p1", true),
      pattern("p2", undefined),
    ]);
    expect(result).toEqual({ detected: 1, total: 2, ratio: 0.5 });
  });

  it("returns ratio null and zero counts for an empty pattern list", () => {
    expect(coverage([])).toEqual({ detected: 0, total: 0, ratio: null });
  });
});

describe("evaluateSamples", () => {
  it("runs the supplied judgeFn over samples and reports recall + FPR", async () => {
    const samples: Sample[] = [
      { kind: "scam", messageBody: "s1" },
      { kind: "scam", messageBody: "s2" },
      { kind: "scam", messageBody: "s3" },
      { kind: "benign", messageBody: "b1" },
      { kind: "benign", messageBody: "b2" },
      { kind: "benign", messageBody: "b3" },
    ];
    const judgeFn = vi.fn(async (s: Sample) => ({
      score: s.kind === "scam" ? 90 : 10,
    }));
    const result = await evaluateSamples(samples, judgeFn, 70);
    expect(result.recall).toBe(1);
    expect(result.fpr).toBe(0);
    expect(result.total).toBe(6);
    expect(result.scamTotal).toBe(3);
    expect(result.benignTotal).toBe(3);
    expect(judgeFn).toHaveBeenCalledTimes(6);
  });

  it("reflects mixed accuracy from the judgeFn", async () => {
    const samples: Sample[] = [
      { kind: "scam", messageBody: "s1" }, // → 80 detected
      { kind: "scam", messageBody: "s2" }, // → 40 missed
      { kind: "benign", messageBody: "b1" }, // → 75 false-flagged
      { kind: "benign", messageBody: "b2" }, // → 10 ok
    ];
    const scores = [80, 40, 75, 10];
    let i = 0;
    const judgeFn = vi.fn(async () => ({ score: scores[i++] }));
    const result = await evaluateSamples(samples, judgeFn, 70);
    expect(result.recall).toBe(1 / 2);
    expect(result.fpr).toBe(1 / 2);
  });
});

describe("getDetectionThreshold", () => {
  it("falls back to default when env is unset", () => {
    expect(getDetectionThreshold()).toBe(DEFAULT_DETECTION_THRESHOLD);
  });

  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["non-numeric", "abc"],
    ["NaN literal", "NaN"],
    ["below range", "-5"],
    ["above range", "150"],
    ["Infinity", "Infinity"],
  ])("falls back to default when env is %s (%s)", (_label, value) => {
    process.env[ENV_KEY] = value;
    expect(getDetectionThreshold()).toBe(DEFAULT_DETECTION_THRESHOLD);
  });

  it.each([
    ["85", 85],
    ["0", 0],
    ["100", 100],
    ["50.5", 50.5],
  ])("uses env value %s when valid in range", (raw, expected) => {
    process.env[ENV_KEY] = raw;
    expect(getDetectionThreshold()).toBe(expected);
  });
});

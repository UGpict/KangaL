import { describe, expect, it } from "vitest";
import type { JudgeResponseBody } from "@/app/api/judge/route";
import { DANGER_SCORE_THRESHOLD } from "@/lib/weights";
import {
  flowFromEvents,
  isCurrent,
  verdictCategory,
  type JudgeEvent,
  type JudgePhase,
} from "@/lib/judgeFlow";

const danger: JudgeResponseBody = {
  degraded: false,
  score: DANGER_SCORE_THRESHOLD, // >= threshold → danger
  reason: "r",
  isolationNote: null,
  investigationBonus: { items: [], total: 0, capped: false },
  investigation: {
    truncated: false,
    truncatedReason: null,
  } as JudgeResponseBody extends { investigation: infer I } ? I : never,
};

const safe: JudgeResponseBody = {
  ...(danger as Extract<JudgeResponseBody, { degraded: false }>),
  score: DANGER_SCORE_THRESHOLD - 1, // < threshold → safe
};

const degraded: JudgeResponseBody = { degraded: true };

describe("verdictCategory", () => {
  it("maps >= threshold to danger, < threshold to safe, degraded to degraded", () => {
    expect(verdictCategory(danger)).toBe("danger");
    expect(verdictCategory(safe)).toBe("safe");
    expect(verdictCategory(degraded)).toBe("degraded");
  });
});

describe("isCurrent", () => {
  it("is true only when the seq matches the latest selection", () => {
    expect(isCurrent(2, 2)).toBe(true);
    expect(isCurrent(1, 2)).toBe(false);
  });
});

describe("flowFromEvents — no red/green before a current confirmed verdict", () => {
  it("starts idle, then investigating on select (never danger/safe yet)", () => {
    expect(flowFromEvents([])).toEqual({ kind: "idle" });
    expect(flowFromEvents([{ type: "select", seq: 1 }])).toEqual({
      kind: "investigating",
    });
  });

  it("renders a terminal verdict only when the current selection settles", () => {
    const phase = flowFromEvents([
      { type: "select", seq: 1 },
      { type: "settled", seq: 1, body: danger },
    ]);
    expect(phase).toMatchObject({ kind: "settled", category: "danger" });
  });

  it("drops a stale settled response from a superseded selection (the race)", () => {
    // User selects A (seq1), then quickly selects B (seq2). A's response lands
    // first with a DANGER score, then B's with SAFE. The stale A must not flip
    // the card — final phase is B's safe, and danger never becomes current.
    const events: JudgeEvent[] = [
      { type: "select", seq: 1 },
      { type: "select", seq: 2 },
      { type: "settled", seq: 1, body: danger }, // stale → dropped
      { type: "settled", seq: 2, body: safe },
    ];
    expect(flowFromEvents(events)).toMatchObject({
      kind: "settled",
      category: "safe",
    });
  });

  it("keeps showing investigating while only a stale response has arrived", () => {
    // After selecting B (seq2), A's stale danger arrives but B has not settled.
    // The card must stay investigating — NOT flash danger.
    const events: JudgeEvent[] = [
      { type: "select", seq: 1 },
      { type: "select", seq: 2 },
      { type: "settled", seq: 1, body: danger }, // stale → dropped
    ];
    expect(flowFromEvents(events)).toEqual({ kind: "investigating" });
  });

  it("ignores a late stale response that arrives after the current one settled", () => {
    const events: JudgeEvent[] = [
      { type: "select", seq: 1 },
      { type: "select", seq: 2 },
      { type: "settled", seq: 2, body: safe },
      { type: "settled", seq: 1, body: danger }, // late stale → dropped
    ];
    expect(flowFromEvents(events)).toMatchObject({
      kind: "settled",
      category: "safe",
    });
  });

  it("never yields a danger/safe phase for any prefix before the current settle", () => {
    const events: JudgeEvent[] = [
      { type: "select", seq: 1 },
      { type: "select", seq: 2 },
      { type: "settled", seq: 1, body: danger },
    ];
    for (let i = 0; i <= events.length; i++) {
      const phase: JudgePhase = flowFromEvents(events.slice(0, i));
      if (phase.kind === "settled") {
        // A settled phase may only appear for the current (latest) seq — here
        // that never happens, so this branch must not be reached.
        throw new Error("unexpected terminal verdict before current settle");
      }
    }
  });

  it("maps a failed current response to an error phase", () => {
    const phase = flowFromEvents([
      { type: "select", seq: 1 },
      { type: "failed", seq: 1, message: "boom" },
    ]);
    expect(phase).toEqual({ kind: "error", message: "boom" });
  });

  it("drops a stale failed response", () => {
    const phase = flowFromEvents([
      { type: "select", seq: 1 },
      { type: "select", seq: 2 },
      { type: "failed", seq: 1, message: "boom" }, // stale → dropped
    ]);
    expect(phase).toEqual({ kind: "investigating" });
  });
});

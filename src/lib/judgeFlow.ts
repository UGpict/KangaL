// Pure, node-testable display-state logic for the judge flow (G3.1). No React,
// no fetch. The architecture fact this encodes: /api/judge returns a SINGLE,
// already-final verdict — there is no intermediate score on the wire. So the
// only way the red/green card can oscillate is a stale/overlapping response
// overwriting the displayed one. This module models the gating rule that makes
// that impossible: a settled verdict is applied only if it belongs to the most
// recent selection (seq). The component (InboxApp) enforces the same rule via a
// seq ref; this is the tested contract it mirrors.

import type { JudgeResponseBody } from "@/app/api/judge/route";
import { DANGER_SCORE_THRESHOLD } from "@/lib/weights";

// Terminal display category. Applies ONLY to a confirmed (settled) response —
// never to a pre-terminal state, because no intermediate verdict exists.
export type VerdictCategory = "danger" | "safe" | "degraded";

export function verdictCategory(body: JudgeResponseBody): VerdictCategory {
  if (body.degraded) return "degraded";
  return body.score >= DANGER_SCORE_THRESHOLD ? "danger" : "safe";
}

// The display phase. `investigating` carries NO red/green — it is the only
// thing shown before a confirmed verdict for the current selection arrives.
export type JudgePhase =
  | { kind: "idle" }
  | { kind: "investigating" }
  | { kind: "settled"; category: VerdictCategory; body: JudgeResponseBody }
  | { kind: "error"; message: string };

// Events in selection order. `select` starts a new judge (and supersedes any
// in-flight one). `settled`/`failed` carry the seq of the selection they answer.
export type JudgeEvent =
  | { type: "select"; seq: number }
  | { type: "settled"; seq: number; body: JudgeResponseBody }
  | { type: "failed"; seq: number; message: string };

// A response is current only if it answers the latest selection. Stale (older
// seq) responses must be dropped so they can never flip the card.
export function isCurrent(seq: number, latestSeq: number): boolean {
  return seq === latestSeq;
}

// Fold an ordered event stream into the single display phase. Stale settled/
// failed events are discarded, which is exactly why a red/green (danger/safe)
// phase can never appear before the CURRENT selection settles.
export function flowFromEvents(events: JudgeEvent[]): JudgePhase {
  let latestSeq = 0;
  let phase: JudgePhase = { kind: "idle" };
  for (const e of events) {
    if (e.type === "select") {
      latestSeq = e.seq;
      phase = { kind: "investigating" };
      continue;
    }
    if (!isCurrent(e.seq, latestSeq)) continue; // stale → drop
    if (e.type === "settled") {
      phase = {
        kind: "settled",
        category: verdictCategory(e.body),
        body: e.body,
      };
    } else {
      phase = { kind: "error", message: e.message };
    }
  }
  return phase;
}

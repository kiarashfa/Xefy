import type { StepPhase } from '../../schemas/vocabularies.ts';

/** The shape the timing engine needs from a step, after flattening. */
export interface TimedStep {
  id: string;
  durationMin: number;
  /** "active", "passive", or "parallel-with:<stepId>". */
  type: string;
  phase?: StepPhase | undefined;
}

export interface TimingTotals {
  prep: number;
  cook: number;
  rest: number;
  total: number;
}

/** A step and everything running concurrently with it. */
export interface ParallelGroup {
  /** The step the others are anchored to. */
  anchorId: string;
  memberIds: string[];
  /** What the group costs: the longest member, not the sum. */
  durationMin: number;
  /** The member whose duration the group takes, and whose phase it lands in. */
  dominantId: string;
}

export const parallelTarget = (type: string): string | null =>
  type.startsWith('parallel-with:') ? type.slice('parallel-with:'.length) : null;

/** Where a step's time belongs on the Prep / Cook / Rest card. */
export function phaseOf(step: TimedStep): StepPhase {
  if (step.type === 'passive') return 'rest';
  return step.phase ?? 'prep';
}

export class TimingError extends Error {}

/**
 * Groups each step with anything declared to run alongside it.
 *
 * A chain (C alongside B, B alongside A) resolves to one group anchored at A,
 * because that is what it describes: three things happening at once.
 */
export function buildParallelGroups(steps: TimedStep[]): ParallelGroup[] {
  const byId = new Map(steps.map((s) => [s.id, s]));

  const rootOf = (step: TimedStep): string => {
    const seen = new Set<string>([step.id]);
    let current = step;
    for (;;) {
      const target = parallelTarget(current.type);
      if (target == null) return current.id;
      const next = byId.get(target);
      if (!next) {
        throw new TimingError(`step "${current.id}" runs alongside "${target}", which does not exist`);
      }
      if (seen.has(next.id)) {
        throw new TimingError(
          `steps ${[...seen].map((s) => `"${s}"`).join(', ')} are declared to run alongside each other in a loop`,
        );
      }
      seen.add(next.id);
      current = next;
    }
  };

  // Insertion order follows the step sequence, so groups stay in method order.
  const members = new Map<string, string[]>();
  for (const step of steps) {
    const root = rootOf(step);
    const list = members.get(root) ?? [];
    list.push(step.id);
    members.set(root, list);
  }

  return [...members].map(([anchorId, memberIds]) => {
    let dominantId = anchorId;
    let durationMin = byId.get(anchorId)!.durationMin;
    for (const id of memberIds) {
      const step = byId.get(id)!;
      // Strictly greater, so a tie leaves the anchor dominant and the result
      // does not depend on ordering.
      if (step.durationMin > durationMin) {
        durationMin = step.durationMin;
        dominantId = id;
      }
    }
    return { anchorId, memberIds, durationMin, dominantId };
  });
}

/**
 * The Prep / Cook / Rest / Total card.
 *
 * Concurrent work is counted once, in the phase of whichever member takes
 * longest — the shorter ones happen inside that span and adding them would
 * claim time the cook never spends. That keeps `total = prep + cook + rest`
 * exactly true, and makes the total identical to the timeline's critical path
 * by construction rather than by coincidence.
 *
 * Timing does not scale with servings. Cooking twice as much does not take
 * twice as long, and pretending otherwise would be a fabricated number in a
 * system built to avoid them.
 */
export function computeTiming(steps: TimedStep[]): TimingTotals {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const totals: TimingTotals = { prep: 0, cook: 0, rest: 0, total: 0 };

  for (const group of buildParallelGroups(steps)) {
    const dominant = byId.get(group.dominantId)!;
    totals[phaseOf(dominant)] += group.durationMin;
  }

  totals.total = totals.prep + totals.cook + totals.rest;
  return totals;
}

/**
 * The same figure the card's Total shows, derived the same way. §3.6 asserts
 * the two agree; they are one calculation, so a divergence would mean the
 * parallel handling had drifted apart in two places.
 */
export function criticalPathTotal(steps: TimedStep[]): number {
  return buildParallelGroups(steps).reduce((sum, group) => sum + group.durationMin, 0);
}

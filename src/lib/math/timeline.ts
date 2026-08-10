import { dayOffset } from './units.ts';
import { buildParallelGroups, criticalPathTotal, phaseOf, type TimedStep } from './timing.ts';

/**
 * The cook-back timeline: not how long a dish takes, but what time to start.
 *
 * This needs no authoring at all. Every step already carries a duration, a
 * phase and a stable id because the timing card needs them, so the schedule is
 * a pure derivation over structure that already exists — which is also why it
 * cannot drift from the timing card.
 */

export type AnchorMode = 'ready-at' | 'start-now';

export interface TimelineAnchor {
  mode: AnchorMode;
  /** The moment to be ready, or the moment work begins. */
  at: Date;
}

export interface TimelineEntry {
  stepId: string;
  start: Date;
  end: Date;
  /**
   * The time worth showing. A passive span reads as when the wait *ends*,
   * because the useful fact about a two-hour proof is when to come back, not
   * when to walk away.
   */
  displayAt: Date;
  isPassive: boolean;
  /** Days between the anchor's day and this entry's, so none is shown bare. */
  dayOffset: number;
}

export interface Timeline {
  entries: TimelineEntry[];
  start: Date;
  end: Date;
  /** Equal to the timing card's Total, by construction. */
  totalMin: number;
  startDayOffset: number;
}

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

/**
 * Walks the critical path assigning clock times.
 *
 * Both anchors reduce to the same walk — working back from a target time is
 * the forward walk with a start computed first. Steps declared to run
 * alongside another begin when it does, so a group costs its longest member
 * and no more.
 *
 * Times are exact. Rounding "18:29" up to "18:30" would invent a number, which
 * is the thing this whole system exists not to do.
 */
export function computeTimeline(steps: TimedStep[], anchor: TimelineAnchor): Timeline {
  const totalMin = criticalPathTotal(steps);
  const start = anchor.mode === 'start-now' ? new Date(anchor.at) : addMinutes(anchor.at, -totalMin);
  const end = addMinutes(start, totalMin);

  const byId = new Map(steps.map((s) => [s.id, s]));
  const times = new Map<string, { start: Date; end: Date }>();

  let cursor = start;
  for (const group of buildParallelGroups(steps)) {
    for (const id of group.memberIds) {
      const step = byId.get(id)!;
      times.set(id, { start: cursor, end: addMinutes(cursor, step.durationMin) });
    }
    cursor = addMinutes(cursor, group.durationMin);
  }

  // Day offsets are measured against the anchor's own day: with a target time
  // this evening, a long ferment starts "yesterday", which is what the reader
  // needs to see.
  const referenceDay = anchor.at;

  const entries: TimelineEntry[] = steps.map((step) => {
    const span = times.get(step.id)!;
    const isPassive = phaseOf(step) === 'rest';
    const displayAt = isPassive ? span.end : span.start;
    return {
      stepId: step.id,
      start: span.start,
      end: span.end,
      displayAt,
      isPassive,
      dayOffset: dayOffset(referenceDay, displayAt),
    };
  });

  return {
    entries,
    start,
    end,
    totalMin,
    startDayOffset: dayOffset(referenceDay, start),
  };
}

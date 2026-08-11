import { computeTimeline, type AnchorMode } from '../math/timeline.ts';
import { dayOffset, formatClock, formatDayOffset, formatDuration } from '../math/units.ts';
import type { TimedStep } from '../math/timing.ts';
import { versionedStore } from '../storage.ts';

/**
 * The cook-back timeline, on the recipe page. §3.8, §19.7
 *
 * Off by default, opened from the Timing card — the card already owns "how
 * long", so "when" belongs in the same slot rather than a new one. When it is
 * on, a summary line sits above the Method and each step's clock time is
 * prepended to the meta line it already has, because per-step timing has a slot
 * and a second mechanism for it would be one too many.
 *
 * Every clock time here is created at runtime and never appears in the built
 * HTML or the JSON-LD. They are generated readouts, not content, so the
 * DOM-persistence rule that keeps step text in the document does not apply.
 *
 * The timeline does not move with the serving stepper, because timing does not
 * scale (§3.3). It is recomputed on a version change, which does change the
 * steps.
 */

const store = versionedStore<{ open: boolean }>('timeline', 1, 1);

interface Panel {
  version: string;
  steps: TimedStep[];
  /** The whole disclosure, in the Timing card. */
  root: HTMLElement;
  toggle: HTMLButtonElement;
  controls: HTMLElement;
  time: HTMLInputElement;
  modeButtons: HTMLButtonElement[];
}

let open = false;

/** Only the target time is ephemeral; it is meaningless tomorrow. §19.7 */
function anchorAt(panel: Panel, mode: AnchorMode): Date {
  if (mode === 'start-now') return new Date();
  const [hours, minutes] = panel.time.value.split(':').map(Number);
  const at = new Date();
  at.setHours(Number.isFinite(hours) ? hours! : 20, Number.isFinite(minutes) ? minutes! : 0, 0, 0);
  return at;
}

const activeMode = (panel: Panel): AnchorMode =>
  (panel.modeButtons.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset
    .mode as AnchorMode) ?? 'ready-at';

/** Removes every generated readout, so "off" leaves the page as it was built. */
function clear(scope: ParentNode): void {
  for (const el of scope.querySelectorAll('[data-generated-clock]')) el.remove();
  for (const el of scope.querySelectorAll('[data-timeline-summary]')) el.remove();
}

function render(panel: Panel): void {
  const scope = document.querySelector<HTMLElement>(`[data-method][data-version="${panel.version}"]`);
  clear(panel.root);
  if (scope) clear(scope);
  if (!open || !scope) return;

  const mode = activeMode(panel);
  const at = anchorAt(panel, mode);
  const timeline = computeTimeline(panel.steps, { mode, at });

  // Neither end of the span is ever shown as a bare clock time that silently
  // belongs to another day — a long ferment puts one of them there. §3.8
  const startOffset = formatDayOffset(timeline.startDayOffset);
  const endOffset = formatDayOffset(dayOffset(at, timeline.end));

  const summary = document.createElement('p');
  summary.className = 'timeline-summary';
  summary.setAttribute('data-timeline-summary', '');
  summary.setAttribute('role', 'status');
  summary.textContent =
    mode === 'start-now'
      ? `Starting now, ready at ${formatClock(timeline.end)}${endOffset ? ` ${endOffset}` : ''} — ${formatDuration(timeline.totalMin)} of elapsed time.`
      : `Start at ${formatClock(timeline.start)}${startOffset ? `, ${startOffset},` : ''} to eat at ${formatClock(timeline.end)}.`;
  scope.prepend(summary);

  for (const entry of timeline.entries) {
    const meta = scope.querySelector<HTMLElement>(`[data-step="${CSS.escape(entry.stepId)}"] .step-meta`);
    if (!meta) continue;
    const clock = document.createElement('span');
    clock.className = 'step-clock';
    clock.setAttribute('data-generated-clock', '');
    const day = formatDayOffset(entry.dayOffset);
    // A passive span reads as when the wait ends: the useful fact about a
    // two-hour proof is when to come back, not when to walk away. §3.8
    // No separator of its own: the meta line already opens with the dot that
    // separates its parts, and a second one stutters.
    clock.textContent = `${formatClock(entry.displayAt)}${day ? ` ${day}` : ''}${entry.isPassive ? ' ready' : ''}`;
    meta.prepend(clock);
  }
}

function readPanels(): Panel[] {
  const panels: Panel[] = [];
  for (const root of document.querySelectorAll<HTMLElement>('[data-timeline]')) {
    const data = root.querySelector<HTMLScriptElement>('script[type="application/json"]');
    const toggle = root.querySelector<HTMLButtonElement>('.timing-link');
    const controls = root.querySelector<HTMLElement>('.timeline-controls');
    const time = root.querySelector<HTMLInputElement>('input[type="time"]');
    if (!data || !toggle || !controls || !time) continue;
    panels.push({
      version: root.dataset.timeline ?? '',
      steps: JSON.parse(data.textContent ?? '[]') as TimedStep[],
      root,
      toggle,
      controls,
      time,
      modeButtons: [...root.querySelectorAll<HTMLButtonElement>('[data-mode]')],
    });
  }
  return panels;
}

export function initTimeline(): void {
  const panels = readPanels();
  if (panels.length === 0) return;

  open = store.read().value?.open === true;

  const renderAll = () => {
    for (const panel of panels) {
      panel.controls.toggleAttribute('hidden', !open);
      panel.toggle.setAttribute('aria-expanded', String(open));
      panel.toggle.textContent = open ? 'Hide timing ↑' : 'Plan my timing →';
      render(panel);
    }
  };

  for (const panel of panels) {
    panel.toggle.addEventListener('click', () => {
      open = !open;
      // The on/off state persists; the target time does not. §19.7
      store.write({ open });
      renderAll();
    });

    panel.time.addEventListener('input', () => render(panel));

    for (const button of panel.modeButtons) {
      button.addEventListener('click', () => {
        for (const other of panel.modeButtons) {
          other.setAttribute('aria-pressed', String(other === button));
        }
        // "Starting now" has no target to set, so the input goes with it.
        panel.time.parentElement?.toggleAttribute('hidden', button.dataset.mode === 'start-now');
        render(panel);
      });
    }
  }

  // A version changes the steps, so it changes the schedule. Timing is the one
  // thing the serving stepper does not touch, so nothing listens to that.
  document.addEventListener('xefy:versionchange', renderAll);

  renderAll();
}

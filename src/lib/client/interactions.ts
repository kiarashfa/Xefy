/**
 * Page interactions.
 *
 * All of these are class or attribute toggles over markup that is already in
 * the document — no islands, no re-rendering. That is what lets the step text,
 * the collapsed make-ahead section, the non-default recipe version and the
 * About panel all stay in the built HTML where crawlers can read them, while
 * still behaving as controls.
 */

import { initPlanControls } from './plan-button.ts';
import { versionedStore } from '../storage.ts';

const themeStore = versionedStore<{ theme: 'light' | 'dark' }>('theme', 1, 1);

function on(selector: string, event: string, handler: (el: HTMLElement, e: Event) => void) {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    el.addEventListener(event, (e) => handler(el, e));
  }
}

function setTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  themeStore.write({ theme });
}

/** Switches one group of `aria-selected` buttons and the panels they name. */
function selectIn(group: HTMLElement, chosen: HTMLElement) {
  for (const button of group.querySelectorAll<HTMLElement>('button[aria-controls]')) {
    const selected = button === chosen;
    button.setAttribute('aria-selected', String(selected));
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (panel) panel.toggleAttribute('hidden', !selected);
  }
}

/**
 * Version switching reaches into both columns.
 *
 * A version changes its ingredients and its timing as much as its method, and
 * those live in the left column while the method lives in the right — so this
 * matches on a value rather than on a single panel id, and shows every block
 * belonging to the chosen version wherever it sits.
 */
function selectVersion(group: HTMLElement, chosen: HTMLElement) {
  const version = chosen.dataset.value;
  for (const button of group.querySelectorAll<HTMLElement>('button[data-value]')) {
    button.setAttribute('aria-selected', String(button === chosen));
  }
  for (const block of document.querySelectorAll<HTMLElement>('[data-version]')) {
    block.toggleAttribute('hidden', block.dataset.version !== version);
  }
  // A version changes the steps, so anything derived from them — the cook-back
  // timeline — has to be told rather than left showing the other version's.
  document.dispatchEvent(new CustomEvent('xefy:versionchange', { detail: { version } }));
}

export function initInteractions(): void {
  // The Plan's count ships in the header on every page, so this runs everywhere.
  initPlanControls(document.documentElement.dataset.base ?? '/');

  on('[data-theme-toggle]', 'click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  on('[data-menu-toggle]', 'click', (el) => {
    const menu = document.querySelector<HTMLElement>('[data-mobile-menu]');
    if (!menu) return;
    const open = menu.hasAttribute('data-open');
    menu.toggleAttribute('data-open', !open);
    el.setAttribute('aria-expanded', String(!open));
  });

  // Recipe / About: swaps the reading column and leaves the recipe's own data
  // in place beside it.
  for (const group of document.querySelectorAll<HTMLElement>('[data-tablist]')) {
    group.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('button[aria-controls]');
      if (button) selectIn(group, button);
    });
  }

  // The version strip: a different control doing a different job, and one that
  // has to reach both columns.
  for (const group of document.querySelectorAll<HTMLElement>('[data-version-tabs]')) {
    group.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('button[data-value]');
      if (button) selectVersion(group, button);
    });
  }

  // Marking a step done changes an attribute and nothing else; the text is
  // never removed from the document.
  on('.step-check', 'click', (el) => {
    const step = el.closest<HTMLElement>('.step');
    if (!step) return;
    const done = step.hasAttribute('data-done');
    step.toggleAttribute('data-done', !done);
    el.setAttribute('aria-pressed', String(!done));
  });

  on('.makeahead-toggle', 'click', (el) => {
    const section = el.closest<HTMLElement>('.makeahead');
    if (!section) return;
    const open = section.hasAttribute('data-open');
    section.toggleAttribute('data-open', !open);
    el.setAttribute('aria-expanded', String(!open));
  });

  on('.sub-hint', 'click', (el) => {
    const body = el.nextElementSibling as HTMLElement | null;
    if (!body) return;
    const open = !body.hasAttribute('hidden');
    body.toggleAttribute('hidden', open);
    el.setAttribute('aria-expanded', String(!open));
  });

  // Hover reveals it on a pointer; this is the keyboard and touch path.
  on('.attribution-toggle', 'click', (el) => {
    const popover = el.nextElementSibling as HTMLElement | null;
    if (!popover) return;
    const open = popover.hasAttribute('data-open');
    popover.toggleAttribute('data-open', !open);
    el.setAttribute('aria-expanded', String(!open));
  });
}

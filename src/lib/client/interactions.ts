/**
 * Page interactions.
 *
 * All of these are class or attribute toggles over markup that is already in
 * the document — no islands, no re-rendering. That is what lets the step text,
 * the collapsed make-ahead section, the non-default recipe version and the
 * About panel all stay in the built HTML where crawlers can read them, while
 * still behaving as controls.
 */

const THEME_KEY = 'xefy.theme.v1';

function on(selector: string, event: string, handler: (el: HTMLElement, e: Event) => void) {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    el.addEventListener(event, (e) => handler(el, e));
  }
}

function setTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify({ schema: 1, theme }));
  } catch {
    // Storage can be unavailable; the toggle still works for this page view.
  }
}

/** Switches one group of `aria-selected` buttons and the panels they name. */
function selectIn(group: HTMLElement, chosen: HTMLElement, attribute: string) {
  for (const button of group.querySelectorAll<HTMLElement>('button[aria-controls]')) {
    const selected = button === chosen;
    button.setAttribute('aria-selected', String(selected));
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (panel) panel.toggleAttribute('hidden', !selected);
  }
  group.dataset.active = chosen.dataset[attribute] ?? '';
}

export function initInteractions(): void {
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

  // Recipe / About, and the version strip inside the Recipe panel. Same
  // mechanism, deliberately different-looking controls.
  for (const group of document.querySelectorAll<HTMLElement>('[data-tablist]')) {
    group.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('button[aria-controls]');
      if (button) selectIn(group, button, 'value');
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

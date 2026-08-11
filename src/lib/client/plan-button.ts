import { addToPlan, loadPlan, plan } from '../plan/store.ts';
import { servings } from '../stores/display.ts';

/**
 * The Plan's two touch points on an ordinary content page: the header count and
 * the "Add to plan" button under the ingredient checklist.
 *
 * Plain DOM rather than an island. Both are a few lines of text over markup the
 * server already rendered, and hydrating a component to write a number into a
 * span would cost more than it does.
 */

/**
 * "Plan · 3", and nothing at all when the plan is empty. The span is rendered
 * server-side with its width reserved, so filling it in cannot shift the nav.
 * §19.4
 */
function renderCount(): void {
  const count = plan.get().items.length;
  for (const el of document.querySelectorAll<HTMLElement>('[data-plan-count]')) {
    el.textContent = count > 0 ? ` · ${count}` : '';
  }
}

/**
 * Adds at the serving count currently showing in the stepper, and swaps in
 * place to a confirmation naming that count with a route to both destinations.
 * No modal, and no selection step — what the reader already has is a question
 * for the list page, where the answer applies across every planned dish at once
 * and can be changed freely. §8.4
 */
function wireAddButtons(base: string): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.add-to-plan[data-add-to-plan]')) {
    button.addEventListener('click', () => {
      const scope = button.closest<HTMLElement>('[data-version]');
      const root = document.querySelector<HTMLElement>('[data-recipe]');
      const slug = root?.dataset.recipe;
      const version = scope?.dataset.version;
      if (!slug || !version) return;

      const count = servings.get() || Number(button.dataset.defaultServings ?? '0');
      if (!count) return;

      addToPlan(slug, version, count);

      const confirmation = document.createElement('p');
      confirmation.className = 'add-confirmed';
      confirmation.setAttribute('role', 'status');
      confirmation.innerHTML =
        `Added at ${count} servings — ` +
        `<a href="${base}plan/">Plan</a> · <a href="${base}shopping-list/">Shopping list</a>`;
      button.replaceWith(confirmation);
    });
  }
}

export function initPlanControls(base: string): void {
  loadPlan();
  renderCount();
  plan.subscribe(renderCount);
  wireAddButtons(base);
}

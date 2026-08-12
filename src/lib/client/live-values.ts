import { formatQuantity, type BaseUnit, type Density } from '../math/quantity.ts';
import { formatCount, formatLength, formatTemperature, type UnitSystem } from '../math/units.ts';
import { restoreServings, restoreUnitSystem, servings, unitSystem } from '../stores/display.ts';


/**
 * The one script that keeps every live value on the page current.
 *
 * Not one island per value. A recipe page carries thirty to fifty quantities,
 * temperatures and dimensions, all driven by exactly two pieces of state, so
 * hydrating each of them separately would ship a great deal of JavaScript to
 * re-render text that a few lines can update in place.
 *
 * It calls the same formatting functions the server used, so the value after a
 * change comes from the same code as the value before it.
 */

const num = (el: HTMLElement, name: string): number | undefined => {
  const raw = el.dataset[name];
  return raw == null ? undefined : Number(raw);
};

function densityOf(el: HTMLElement): Density | undefined {
  const gPerMl = num(el, 'gPerMl');
  if (gPerMl == null) return undefined;
  return {
    gPerMl,
    source: el.dataset.densitySource === 'estimated' ? 'estimated' : 'measured',
  };
}

function updateQuantity(el: HTMLElement, count: number, system: UnitSystem): void {
  const amount = num(el, 'amount');
  const defaultServings = num(el, 'defaultServings');
  const unit = el.dataset.unit as BaseUnit | undefined;
  if (amount == null || defaultServings == null || !defaultServings || !unit) return;

  const scaled = amount * (count / defaultServings) * (num(el, 'fraction') ?? 1);
  const perUnit = num(el, 'countGrams');
  const { text, estimated } = formatQuantity(scaled, unit, system, densityOf(el), perUnit != null);

  const target = el.querySelector<HTMLElement>('.qty-amount');
  if (!target) return;
  target.textContent = estimated ? `~${text}` : text;
  target.classList.toggle('is-estimated', estimated);

  // Countable things carry a count alongside the weight, and it scales with it.
  const countEl = el.querySelector<HTMLElement>('.qty-count');
  const nameEl = el.querySelector<HTMLElement>('.qty-name');
  if (perUnit && countEl && nameEl) {
    const rendered = formatCount(scaled / perUnit);
    countEl.textContent = rendered;
    nameEl.textContent =
      rendered === '1' ? (el.dataset.countSingular ?? '') : (el.dataset.countPlural ?? '');
  }
}

/**
 * A figure that is stated per serving and multiplies up — a recipe's total
 * energy, as against the per-serving figure, which does not move at all when
 * the stepper does.
 */
function updatePerServing(el: HTMLElement, count: number): void {
  const perServing = num(el, 'perServing');
  if (perServing == null) return;
  const value = perServing * count;
  const decimals = num(el, 'decimals') ?? 0;
  el.textContent = value.toFixed(decimals);
}

/**
 * Applies the current state to the whole document.
 *
 * Durations are absent on purpose: they scale with neither serving count nor
 * unit system, so what the server rendered stays correct for the life of the
 * page.
 */
export function applyDisplayState(root: ParentNode = document): void {
  const count = servings.get();
  const system = unitSystem.get();

  if (count > 0) {
    for (const el of root.querySelectorAll<HTMLElement>('[data-qty]')) {
      updateQuantity(el, count, system);
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-per-serving]')) {
      updatePerServing(el, count);
    }
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-temp-c]')) {
    const c = num(el, 'tempC');
    if (c != null) el.textContent = formatTemperature(c, system);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-len-cm]')) {
    const cm = num(el, 'lenCm');
    if (cm != null) el.textContent = formatLength(cm, system);
  }
}

/**
 * Wires the page up. `recipeSlug` and `defaultServings` come from the rendered
 * document, so the script has no build-time knowledge of the recipe it is on.
 */
export function initLiveValues(): void {
  const root = document.querySelector<HTMLElement>('[data-recipe]');
  restoreUnitSystem();
  if (root) {
    restoreServings(root.dataset.recipe ?? '', Number(root.dataset.defaultServings ?? '0'));
  } else {
    // A page with live values but no serving count — a Component's own page,
    // where the amounts are a batch. The store starts at zero so that a recipe
    // never renders against a placeholder count before its real one is
    // restored, and that guard would otherwise leave these quantities frozen
    // in whatever system the server happened to pick.
    servings.set(1);
  }

  applyDisplayState();
  servings.subscribe(() => applyDisplayState());
  unitSystem.subscribe(() => applyDisplayState());
}

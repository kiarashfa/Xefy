<script lang="ts">
  /**
   * The Plan as a week. §8.5
   *
   * The same list the shopping list reads, shown by day, with the nutrition
   * arithmetic this site is unusually well placed to do: what a week of cooking
   * actually comes to, and what that averages per portion.
   *
   * Days are relative weekday slots, not dates — no calendar, no rollover, and
   * no persistence semantics a localStorage feature should not take on.
   */
  import { aggregateNutrition } from '../lib/plan/aggregate.ts';
  import { catalog, details, ensureCatalog, ensureDetails, loadError } from '../lib/plan/client.ts';
  import { describeDropped, resolvePlan, totalPortions, type ResolvedPlanItem } from '../lib/plan/resolve.ts';
  import {
    addToPlan,
    clearPlan,
    loadPlan,
    plan,
    planNotice,
    removeFromPlan,
    setItemDay,
    setItemListOnly,
    setItemServings,
  } from '../lib/plan/store.ts';
  import { DAYS, DAY_LABELS, type Day } from '../lib/plan/types.ts';
  import { encodePlanFragment, planText } from '../lib/plan/share.ts';
  import ShareTargets from './ShareTargets.svelte';
  import { formatNutrient, type Nutrient } from '../lib/math/nutrition.ts';
  import { formatDuration } from '../lib/math/units.ts';

  interface Props {
    base: string;
  }
  const { base }: Props = $props();

  loadPlan();
  ensureCatalog(base);

  const resolution = $derived(resolvePlan($plan, $catalog ?? []));
  const dropped = $derived(describeDropped(resolution.dropped));

  $effect(() => {
    ensureDetails(base, resolution.items.map((i) => i.recipe.slug));
  });

  // Shopping-only items are not meals anybody has planned to eat, so they stay
  // out of what the week comes to — while still reaching the shopping list.
  const nutrition = $derived(aggregateNutrition(planned, $details));

  /* Three groups: in the week, meant to be cooked but unplaced, and wanted for
     the shopping alone. Only the first two are meals anybody has planned. */
  const planned = $derived(resolution.items.filter((i) => !i.item.listOnly));
  const listOnly = $derived(resolution.items.filter((i) => i.item.listOnly));
  const unscheduled = $derived(planned.filter((i) => i.item.day === null));
  const byDay = $derived(
    DAYS.map((day) => ({
      day,
      label: DAY_LABELS[day],
      items: planned.filter((i) => i.item.day === day),
    })),
  );

  /* --- adding a dish from this page ---------------------------------- */

  /** Which day's picker is open, so only one is at a time. */
  let adding = $state<Day | null>(null);
  let query = $state('');

  const matches = $derived(
    query.trim().length === 0
      ? []
      : ($catalog ?? [])
          .filter((r) => r.title.toLowerCase().includes(query.trim().toLowerCase()))
          .slice(0, 8),
  );

  function addOn(day: Day, slug: string) {
    const record = ($catalog ?? []).find((r) => r.slug === slug);
    const version = record?.versions[0];
    if (!version) return;
    const item = addToPlan(slug, version.id, version.defaultServings);
    setItemDay(item.uid, day);
    query = '';
    adding = null;
  }

  /** The recipe page's nutrition card, at plan scale — same labels, same units. */
  const MACROS: [Nutrient, string][] = [
    ['kcal', 'kcal'],
    ['protein', 'Protein'],
    ['carbs', 'Carbs'],
    ['fat', 'Fat'],
  ];

  const versionDetail = (entry: ResolvedPlanItem) =>
    $details.get(entry.recipe.slug)?.versions.find((v) => v.id === entry.item.version);

  /* Sharing the week — a message to one person, not a post. §8.4 */
  function planUrl(): string {
    return `${location.origin}${location.pathname}${encodePlanFragment(resolution.items)}`;
  }

  const planMessage = $derived(planText(resolution.items, DAY_LABELS, DAYS, planUrl()));
  const planBody = $derived(planText(resolution.items, DAY_LABELS, DAYS));

  /** The week as structured data, for an assistant rather than a person. */
  const payload = $derived({
    kind: 'xefy.meal-plan',
    generated: new Date().toISOString().slice(0, 10),
    url: planUrl(),
    days: DAYS.map((day) => ({
      day: DAY_LABELS[day],
      dishes: planned
        .filter((i) => i.item.day === day)
        .map((i) => ({
          recipe: i.recipe.title,
          slug: i.recipe.slug,
          version: i.version.label,
          servings: i.item.servings,
          kcalPerServing: versionDetail(i)?.perServing.kcal ?? null,
        })),
    })).filter((d) => d.dishes.length > 0),
    unscheduled: planned
      .filter((i) => i.item.day === null)
      .map((i) => ({ recipe: i.recipe.title, slug: i.recipe.slug, servings: i.item.servings })),
    shoppingOnly: listOnly.map((i) => ({
      recipe: i.recipe.title,
      slug: i.recipe.slug,
      servings: i.item.servings,
    })),
  });

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  let copied = $state('');

  async function copy() {
    try {
      await navigator.clipboard.writeText(planMessage);
      copied = 'Copied to the clipboard.';
    } catch {
      copied = 'This browser would not let the page copy for you — select the plan and copy it.';
    }
  }

  async function share() {
    try {
      await navigator.share({ title: 'Meal plan — Xefy', text: planMessage });
    } catch {
      // A cancelled share is the ordinary case and is not an error.
    }
  }

  const keeps = (entry: ResolvedPlanItem): string | null => {
    const ahead = versionDetail(entry)?.makeAhead;
    if (!ahead) return null;
    const freezes =
      ahead.freezable === null ? null : ahead.freezable ? 'freezes well' : 'does not freeze well';
    return [ahead.aheadInstructions, freezes].filter(Boolean).join(' · ') || null;
  };
</script>

{#if $loadError}
  <p class="empty-state">{$loadError}</p>
{:else}
  {#if resolution.items.length === 0}
    <p class="empty-state">
      Nothing planned yet. Add a dish to any day below, from any
      <a href={`${base}recipes/`}>recipe page</a>, or from
      <a href={`${base}what-can-i-make/`}>what you already have</a>. The
      <a href={`${base}shopping-list/`}>shopping list</a> works itself out from the serving counts
      you choose.
    </p>
  {/if}
  {#if dropped}<p class="plan-dropped">{dropped}</p>{/if}
  {#if $planNotice}<p class="plan-dropped">{$planNotice}</p>{/if}

  <div class="two-col">
    <aside class="left-stack">
      <div class="side-card">
        <div class="side-card-label">This plan</div>
        <div class="nutrition-major">
          {#each MACROS as [key, label] (key)}
            <div class="nutri-stat">
              <div class="val">
                {formatNutrient(nutrition.totals[key] ?? 0, key)}{key === 'kcal' ? '' : 'g'}
              </div>
              <div class="lbl">{label}</div>
            </div>
          {/each}
        </div>
        <p class="source-line">
          {resolution.items.length}
          {resolution.items.length === 1 ? 'dish' : 'dishes'}, {nutrition.portions} portions.
        </p>
      </div>

      <div class="side-card">
        <div class="side-card-label">Per portion, across the plan</div>
        <div class="nutrition-grid">
          {#each MACROS as [key, label] (key)}
            <div>
              <span>{label}</span>
              <b>
                {formatNutrient(nutrition.perPortion[key] ?? 0, key)}{key === 'kcal' ? '' : 'g'}
              </b>
            </div>
          {/each}
        </div>
        <p class="nutrition-note">
          As prepared with these ingredients, not as eaten.
          {#if nutrition.estimated}
            Estimated — {nutrition.reasons.join(' ')}
          {/if}
        </p>
      </div>

      <div class="side-card">
        <div class="side-card-label">Send it</div>
        <div class="share-actions">
          {#if canShare}
            <button class="add-to-plan" onclick={share}>Share…</button>
          {/if}
          <button class="add-to-plan" onclick={copy}>Copy as text</button>
        </div>
        {#if copied}<p class="source-line" role="status">{copied}</p>{/if}
        <ShareTargets
          mode="message"
          text={planMessage}
          body={planBody}
          url={planUrl()}
          title="Meal plan — Xefy"
          payload={payload}
        />
        <p class="source-line">
          The link carries the plan itself, so whoever opens it can copy the whole week into their
          own.
        </p>
      </div>

      <div class="side-card">
        <div class="side-card-label">Next</div>
        <a class="add-to-plan is-link" href={`${base}shopping-list/`}>Shopping list</a>
        <button class="plan-clear" onclick={clearPlan}>Empty this plan</button>
        <p class="source-line">
          This plan lives in this browser and nowhere else. There is no account behind it, so
          clearing site data or changing device will lose it.
        </p>
      </div>
    </aside>

    <div>
      {#snippet row(entry: ResolvedPlanItem)}
        {@const detail = versionDetail(entry)}
        {@const keepsFor = keeps(entry)}
        <li class="plan-row">
          <div class="plan-row-head">
            <a class="plan-row-title" href={`${base}recipes/${entry.recipe.slug}/`}>
              {entry.recipe.title}
            </a>
            <span class="ing-note">{entry.version.label}</span>
          </div>

          <div class="plan-row-figures">
            <span>
              <b>{entry.item.servings}</b> portions
            </span>
            {#if detail}
              <!-- The dish's own per-serving figures, which already exist. §8.5 -->
              <span>
                <b>{formatNutrient(detail.perServing.kcal ?? 0, 'kcal')}</b> kcal each
              </span>
              {#each MACROS.slice(1) as [key, label] (key)}
                {#if detail.perServing[key] != null}
                  <span>
                    <b>{formatNutrient(detail.perServing[key] ?? 0, key)}g</b>
                    {label.toLowerCase()}
                  </span>
                {/if}
              {/each}
            {/if}
            <!-- Timing does not scale with portions (§3.5), so this is the dish's
                 own time and is never summed across the plan. -->
            <span><b>{formatDuration(entry.recipe.totalMin)}</b> to cook</span>
          </div>

          {#if keepsFor}<p class="plan-row-keeps">{keepsFor}</p>{/if}

          <div class="plan-row-controls">
            <label>
              <span class="fact-label">Portions</span>
              <input
                type="number"
                min="1"
                max="24"
                value={entry.item.servings}
                oninput={(e) => setItemServings(entry.item.uid, e.currentTarget.valueAsNumber)}
              />
            </label>
            <label>
              <span class="fact-label">Day</span>
              <!-- A select rather than drag-and-drop: operable by keyboard and
                   screen reader with no extra work. §8.5 -->
              <select
                value={entry.item.listOnly ? 'list' : (entry.item.day ?? '')}
                onchange={(e) => {
                  const value = e.currentTarget.value;
                  if (value === 'list') {
                    setItemListOnly(entry.item.uid, true);
                    return;
                  }
                  if (entry.item.listOnly) setItemListOnly(entry.item.uid, false);
                  setItemDay(entry.item.uid, (value || null) as Day | null);
                }}
              >
                <option value="">No day yet</option>
                {#each DAYS as day (day)}
                  <option value={day}>{DAY_LABELS[day]}</option>
                {/each}
                <option value="list">Shopping only</option>
              </select>
            </label>
            <button
              class="plan-remove"
              onclick={() => removeFromPlan(entry.item.uid)}
              aria-label={`Remove ${entry.recipe.title} from the plan`}
            >
              Remove
            </button>
          </div>
        </li>
      {/snippet}

      {#snippet dayAdder(day: Day)}
        {#if adding === day}
          <div class="day-adder is-open">
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="catalog-search"
              type="search"
              bind:value={query}
              autofocus
              placeholder="Search dishes…"
              aria-label={`Find a dish for ${DAY_LABELS[day]}`}
              onkeydown={(e) => {
                if (e.key === 'Escape') {
                  adding = null;
                  query = '';
                }
              }}
            />
            {#if matches.length > 0}
              <ul class="day-adder-results">
                {#each matches as m (m.slug)}
                  <li>
                    <button onclick={() => addOn(day, m.slug)}>
                      {m.title}
                      <span class="ing-note">{m.style}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {:else if query.trim()}
              <p class="plan-day-empty">Nothing matches that.</p>
            {/if}
            <button class="plan-remove" onclick={() => { adding = null; query = ''; }}>
              Cancel
            </button>
          </div>
        {:else}
          <button
            class="day-adder-open"
            onclick={() => { adding = day; query = ''; }}
            aria-label={`Add a dish to ${DAY_LABELS[day]}`}
          >
            <span aria-hidden="true">+</span> Add a dish
          </button>
        {/if}
      {/snippet}

      {#if unscheduled.length > 0}
        <section class="plan-day">
          <h2 class="panel-title">Not yet given a day</h2>
          <ul class="plan-rows">
            {#each unscheduled as entry (entry.item.uid)}{@render row(entry)}{/each}
          </ul>
        </section>
      {/if}

      <!--
        The week is always here, empty days included. It was hidden until
        something was assigned, on the reasoning that seven empty headings are
        filler — but an empty week that can be filled *in place* is the page's
        starting state rather than padding, and hiding the only structure the
        page has left a first visit with nothing to act on.
      -->
      {#each byDay as slot (slot.day)}
        <section class="plan-day">
          <h2 class="panel-title">
            {slot.label}
            {#if slot.items.length > 0}
              <span class="plan-day-total">
                {formatNutrient(
                  slot.items.reduce((sum, e) => {
                    const per = versionDetail(e)?.perServing.kcal ?? 0;
                    return sum + per * e.item.servings;
                  }, 0),
                  'kcal',
                )} kcal · {totalPortions(slot.items)} portions
              </span>
            {/if}
          </h2>
          {#if slot.items.length > 0}
            <ul class="plan-rows">
              {#each slot.items as entry (entry.item.uid)}{@render row(entry)}{/each}
            </ul>
          {/if}
          {@render dayAdder(slot.day)}
        </section>
      {/each}

      {#if listOnly.length > 0}
        <section class="plan-day">
          <h2 class="panel-title">Shopping only</h2>
          <p class="plan-day-empty">
            On the list, not in the week. Give one a day and it joins the plan proper.
          </p>
          <ul class="plan-rows">
            {#each listOnly as entry (entry.item.uid)}{@render row(entry)}{/each}
          </ul>
        </section>
      {/if}
    </div>
  </div>
{/if}

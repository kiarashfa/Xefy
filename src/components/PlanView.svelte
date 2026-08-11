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
    clearPlan,
    loadPlan,
    plan,
    planNotice,
    removeFromPlan,
    setItemDay,
    setItemServings,
  } from '../lib/plan/store.ts';
  import { DAYS, DAY_LABELS, type Day } from '../lib/plan/types.ts';
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

  const nutrition = $derived(aggregateNutrition(resolution.items, $details));

  const unscheduled = $derived(resolution.items.filter((i) => i.item.day === null));
  const anyScheduled = $derived(unscheduled.length < resolution.items.length);
  const byDay = $derived(
    DAYS.map((day) => ({
      day,
      label: DAY_LABELS[day],
      items: resolution.items.filter((i) => i.item.day === day),
    })),
  );

  /** The recipe page's nutrition card, at plan scale — same labels, same units. */
  const MACROS: [Nutrient, string][] = [
    ['kcal', 'kcal'],
    ['protein', 'Protein'],
    ['carbs', 'Carbs'],
    ['fat', 'Fat'],
  ];

  const versionDetail = (entry: ResolvedPlanItem) =>
    $details.get(entry.recipe.slug)?.versions.find((v) => v.id === entry.item.version);

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
{:else if resolution.items.length === 0}
  <p class="empty-state">
    Nothing planned yet. Add a dish from any <a href={`${base}recipes/`}>recipe page</a> and it will
    appear here, with the <a href={`${base}shopping-list/`}>shopping list</a> worked out from the
    serving counts you chose — or start from
    <a href={`${base}what-can-i-make/`}>what you already have</a>.
  </p>
  {#if dropped}<p class="plan-dropped">{dropped}</p>{/if}
  {#if $planNotice}<p class="plan-dropped">{$planNotice}</p>{/if}
{:else}
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
                value={entry.item.day ?? ''}
                onchange={(e) =>
                  setItemDay(entry.item.uid, (e.currentTarget.value || null) as Day | null)}
              >
                <option value="">Unscheduled</option>
                {#each DAYS as day (day)}
                  <option value={day}>{DAY_LABELS[day]}</option>
                {/each}
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

      {#if unscheduled.length > 0}
        <section class="plan-day">
          <h2 class="panel-title">Unscheduled</h2>
          <ul class="plan-rows">
            {#each unscheduled as entry (entry.item.uid)}{@render row(entry)}{/each}
          </ul>
        </section>
      {/if}

      {#if !anyScheduled}
        <!--
          Seven empty day headings is filler, not a week. The week appears the
          moment it means something, and until then the control that produces
          it is named instead.
        -->
        <p class="plan-day-empty week-hint">
          Nothing is assigned to a day yet. Give any dish a day above and the week appears here,
          with what each day comes to.
        </p>
      {/if}

      {#each anyScheduled ? byDay : [] as slot (slot.day)}
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
          {#if slot.items.length === 0}
            <p class="plan-day-empty">Nothing planned.</p>
          {:else}
            <ul class="plan-rows">
              {#each slot.items as entry (entry.item.uid)}{@render row(entry)}{/each}
            </ul>
          {/if}
        </section>
      {/each}
    </div>
  </div>
{/if}

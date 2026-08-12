<script lang="ts">
  /**
   * The shopping list — the Plan, aggregated. §8.4
   *
   * Nothing here is stored: every amount is summed from the plan's references
   * against the current catalogue each time the page opens, so a list made a
   * month ago benefits from every correction made since.
   */
  import UnitToggle from './UnitToggle.svelte';
  import ShareTargets from './ShareTargets.svelte';
  import { unitSystem, restoreUnitSystem } from '../lib/stores/display.ts';
  import {
    aggregateList,
    displayAmount,
    displayName,
    groupList,
    type ListLine,
  } from '../lib/plan/aggregate.ts';
  import { catalog, details, ensureCatalog, ensureDetails, loadError } from '../lib/plan/client.ts';
  import { describeDropped, resolvePlan } from '../lib/plan/resolve.ts';
  import { decodePlanFragment, encodePlanFragment, shareText } from '../lib/plan/share.ts';
  import {
    copyIntoPlan,
    loadPlan,
    plan,
    planNotice,
    toggleHave,
    toggleNeedStaple,
  } from '../lib/plan/store.ts';
  import { EMPTY_PLAN, type Plan } from '../lib/plan/types.ts';

  interface Props {
    base: string;
    staples: string[];
  }
  const { base, staples }: Props = $props();

  restoreUnitSystem();
  loadPlan();

  /*
   * A shared link opens read-only and never overwrites what the reader already
   * has. The fragment behind it is tracked rather than read once: pasting a
   * link into the bar while already on this page is a same-document navigation
   * — no reload, no re-initialisation — so reading `location.hash` at start-up
   * would show the reader their own list under someone else's link.
   */
  let hash = $state(location.hash);
  let copied = $state<string | null>(null);
  let staplesOpen = $state(false);

  $effect(() => {
    const sync = () => (hash = location.hash);
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  });

  ensureCatalog(base);

  const shared = $derived(hash.startsWith('#p='));

  // Decoded once the catalogue is in: on first paint there is nothing to
  // resolve slugs against, and an unresolved slug is discarded rather than shown.
  const sharedPlan = $derived<Plan>(
    $catalog
      ? {
          ...EMPTY_PLAN,
          items: decodePlanFragment(hash, $catalog).map((i, n) => ({ ...i, uid: `s${n}` })),
        }
      : EMPTY_PLAN,
  );

  const active = $derived<Plan>(shared ? sharedPlan : $plan);

  const resolution = $derived(resolvePlan(active, $catalog ?? []));
  const dropped = $derived(shared ? null : describeDropped(resolution.dropped));

  $effect(() => {
    ensureDetails(base, resolution.items.map((i) => i.recipe.slug));
  });

  const lines = $derived(aggregateList(resolution.items, $details, staples));
  const groups = $derived(groupList(lines, active));

  const text = $derived(
    shareText(groups.toBuy, resolution.items, $unitSystem, shareUrl()),
  );

  // The same list without the trailing URL, for the destinations that take a
  // link in a parameter of their own and would otherwise repeat it.
  const body = $derived(shareText(groups.toBuy, resolution.items, $unitSystem));

  function shareUrl(): string {
    const fragment = encodePlanFragment(resolution.items);
    return `${location.origin}${location.pathname}${fragment}`;
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = 'Copied to the clipboard.';
    } catch {
      copied = 'This browser would not let the page copy for you — select the list and copy it.';
    }
  }

  async function share() {
    try {
      await navigator.share({ title: 'Shopping list — Xefy', text });
    } catch {
      // A cancelled share is the ordinary case and is not an error.
    }
  }

  /** Adds rather than replaces: a link must not be able to lose someone's plan. */
  function adoptShared() {
    const added = copyIntoPlan(sharedPlan.items.map(({ uid, ...rest }) => rest));
    // Dropping the fragment is what leaves the shared view — and `replaceState`
    // fires no hashchange, so the tracked value is set alongside it.
    history.replaceState(null, '', location.pathname);
    hash = '';
    copied = `${added} ${added === 1 ? 'dish' : 'dishes'} added to your plan.`;
  }

  const amountOf = (line: ListLine) => displayAmount(line, $unitSystem);
</script>

{#if $loadError}
  <p class="empty-state">{$loadError}</p>
{:else if resolution.items.length === 0}
  <p class="empty-state">
    {#if shared}
      That link does not name anything on the site — it may have been shortened or edited in
      transit.
    {:else}
      Nothing planned yet, so there is nothing to buy. Add a dish from any
      <a href={`${base}recipes/`}>recipe page</a>, or start from
      <a href={`${base}what-can-i-make/`}>what you already have</a>.
    {/if}
  </p>
{:else}
  {#if shared}
    <div class="plan-banner">
      <span>Someone shared this list with you. Nothing here is saved to your own plan yet.</span>
      <button class="add-to-plan is-inline" onclick={adoptShared}>Copy to my plan</button>
    </div>
  {/if}

  <div class="two-col">
    <aside class="left-stack">
      <div class="side-card is-row">
        <span class="side-card-label">Units</span>
        <UnitToggle />
      </div>

      <div class="side-card">
        <div class="side-card-label">For</div>
        <ul class="plan-for">
          {#each resolution.items as entry (entry.item.uid)}
            <li>
              <a href={`${base}recipes/${entry.recipe.slug}/`}>{entry.recipe.title}</a>
              <span class="ing-note">
                {entry.version.label} · {entry.item.servings} servings
              </span>
            </li>
          {/each}
        </ul>
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
          text={text}
          body={body}
          url={shareUrl()}
          title="Shopping list — Xefy"
        />

        <p class="source-line">
          The link carries the plan rather than the list, so whoever opens it sees the amounts
          worked out in their own units.
          {#if canShare}
            Share… opens your device's own sheet, which is how to reach Instagram Direct, an X
            message, Signal and anything else installed on it — none of those can be opened with a
            message already written from a web page.
          {/if}
        </p>
      </div>
    </aside>

    <div>
      {#if dropped}<p class="plan-dropped">{dropped}</p>{/if}
      {#if $planNotice && !shared}<p class="plan-dropped">{$planNotice}</p>{/if}

      <h2 class="panel-title">To buy</h2>
      {#if groups.toBuy.length === 0}
        <p class="empty-state">Everything on this plan is ticked off or assumed in the cupboard.</p>
      {:else}
        <ul class="ingredients list-lines">
          {#each groups.toBuy as line (line.key)}
            {@const amount = amountOf(line)}
            <li>
              {#if !shared}
                <input
                  class="chk"
                  type="checkbox"
                  checked={false}
                  onchange={() => toggleHave(line.ingredientRef)}
                  aria-label={`Mark ${displayName(line)} as already have`}
                />
              {/if}
              <span class="ing-text">
                <span class="qty">
                  <span class="qty-amount" class:is-estimated={amount.estimated}>
                    {amount.estimated ? '~' : ''}{amount.text}
                  </span>
                  {#if amount.count}<span class="list-count">({amount.count})</span>{/if}
                </span>
                <a class="list-name" href={`${base}ingredients/${line.ingredientRef}/`}>
                  {displayName(line)}
                </a>
                {#if line.optional}<span class="list-optional">optional</span>{/if}
                <span class="ing-note">
                  {line.sources.map((s) => s.title).join(' · ')}
                  {#if line.boughtFor.length > 0}
                    — enough for the {line.boughtFor.join(' and the ')} too
                  {/if}
                </span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}

      {#if groups.alreadyHave.length > 0}
        <h2 class="panel-title has-space">Already have</h2>
        <ul class="ingredients list-lines is-had">
          {#each groups.alreadyHave as line (line.key)}
            {@const amount = amountOf(line)}
            <li>
              {#if !shared}
                <input
                  class="chk"
                  type="checkbox"
                  checked
                  onchange={() => toggleHave(line.ingredientRef)}
                  aria-label={`Put ${displayName(line)} back on the list`}
                />
              {/if}
              <span class="ing-text">
                <span class="qty"><span class="qty-amount">{amount.text}</span></span>
                <span class="list-name">{displayName(line)}</span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}

      {#if groups.staples.length > 0}
        <section class="makeahead staples" data-open={staplesOpen ? '' : undefined}>
          <button
            class="makeahead-toggle"
            aria-expanded={staplesOpen}
            onclick={() => (staplesOpen = !staplesOpen)}
          >
            <span class="makeahead-title">
              Pantry staples — assumed you have these ({groups.staples.length})
            </span>
            <span class="makeahead-chevron">▾</span>
          </button>
          <div class="makeahead-body">
            <p class="source-line">
              Left off the list rather than left out of it. Anything you have actually run out of
              can be moved across.
            </p>
            <ul class="ingredients list-lines">
              {#each groups.staples as line (line.key)}
                {@const amount = amountOf(line)}
                <li>
                  {#if !shared}
                    <input
                      class="chk"
                      type="checkbox"
                      checked={false}
                      onchange={() => toggleNeedStaple(line.ingredientRef)}
                      aria-label={`Add ${displayName(line)} to the list`}
                    />
                  {/if}
                  <span class="ing-text">
                    <span class="qty"><span class="qty-amount">{amount.text}</span></span>
                    <span class="list-name">{displayName(line)}</span>
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        </section>
      {/if}

      <p class="source-line">
        Amounts are the computed totals, not package sizes — Xefy has no product data and will not
        guess at one.
      </p>
    </div>
  </div>
{/if}

<script lang="ts">
  /**
   * "What can I make" — tick what you have, ranked by how close each dish is.
   *
   * Ranked by match percentage rather than a binary full-subset test, because
   * "you have five of six" is the useful answer and "no results" is not. Each
   * result names exactly what is missing.
   */
  import { addToPlan, loadPlan } from '../lib/plan/store.ts';
  import type { CatalogRecord } from '../lib/plan/types.ts';

  interface Props {
    recipes: CatalogRecord[];
    ingredients: { id: string; name: string; category: string }[];
    staples: string[];
    base: string;
  }

  const { recipes, ingredients, staples, base }: Props = $props();

  loadPlan();

  /** Which results have been added, so the control confirms in place. */
  let added = $state<string[]>([]);

  // Closing the loop between "what can I nearly make" and "what do I need to
  // buy" — at the default version and its own serving count, since neither has
  // been chosen here. §8.2
  function add(recipe: CatalogRecord) {
    const version = recipe.versions[0];
    if (!version) return;
    addToPlan(recipe.slug, version.id, version.defaultServings);
    added = [...added, recipe.slug];
  }

  const THRESHOLD = 0.5;

  let have = $state<string[]>([]);
  let filter = $state('');

  /**
   * The homepage teaser hands its selection over in the fragment. It is
   * untrusted input like any other, so every id is resolved against the real
   * ingredient list and anything that does not match is discarded rather than
   * carried.
   *
   * Read on `hashchange` as well as at start-up: arriving at a fragment on the
   * page you are already on is a same-document navigation, so nothing
   * re-initialises and a one-shot read would silently ignore it.
   */
  function readFragment() {
    const raw = /(?:^|&)have=([^&]*)/.exec(location.hash.replace(/^#/, ''));
    if (!raw?.[1]) return;
    const known = new Set(ingredients.map((i) => i.id));
    const picked = decodeURIComponent(raw[1])
      .split(',')
      .filter((id) => known.has(id) && !staples.includes(id));
    if (picked.length > 0) have = [...new Set(picked)];
  }

  $effect(() => {
    readFragment();
    window.addEventListener('hashchange', readFragment);
    return () => window.removeEventListener('hashchange', readFragment);
  });

  // Staples are assumed and excluded from the checklist and from matching
  // entirely — nobody wants to tick "water". §8.2
  const selectable = $derived(
    ingredients
      .filter((i) => !staples.includes(i.id))
      .filter((i) => !filter || i.name.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  const nameOf = (id: string) => ingredients.find((i) => i.id === id)?.name ?? id;

  const results = $derived(
    recipes
      .map((r) => {
        const needed: string[] = r.ingredients.filter((id: string) => !staples.includes(id));
        const missing = needed.filter((id) => !have.includes(id));
        return {
          recipe: r,
          needed: needed.length,
          missing,
          score: needed.length === 0 ? 1 : (needed.length - missing.length) / needed.length,
        };
      })
      .filter((m) => m.score >= THRESHOLD && have.length > 0)
      .sort((a, b) => b.score - a.score || a.missing.length - b.missing.length),
  );

  const toggle = (id: string) =>
    (have = have.includes(id) ? have.filter((x) => x !== id) : [...have, id]);
</script>

<div class="two-col">
  <aside>
    <div class="side-card">
      <div class="side-card-label">What you have</div>
      <input
        class="catalog-search"
        style="width:100%;max-width:none;margin-bottom:12px"
        type="search"
        bind:value={filter}
        placeholder="Filter ingredients…"
        aria-label="Filter the ingredient list"
      />
      <ul class="ingredients" style="max-height:460px;overflow-y:auto">
        {#each selectable as i (i.id)}
          <li>
            <input
              class="chk"
              type="checkbox"
              checked={have.includes(i.id)}
              onchange={() => toggle(i.id)}
              id={`have-${i.id}`}
            />
            <label class="ing-text" for={`have-${i.id}`}>{i.name}</label>
          </li>
        {/each}
      </ul>
      <p class="source-line">
        Salt, oil, flour and the rest of the cupboard are assumed — they are not listed and they do
        not count against a match.
      </p>
    </div>
  </aside>

  <div>
    {#if have.length === 0}
      <p class="empty-state">
        Tick a few things and the dishes you are closest to making will appear here, nearest first.
      </p>
    {:else if results.length === 0}
      <p class="empty-state">
        Nothing is within reach of that yet — with {recipes.length} dishes on the site, that is more a
        comment on the catalogue than on your cupboard.
      </p>
    {:else}
      <p class="catalog-count">
        {results.length} within reach of {have.length} ingredient{have.length === 1 ? '' : 's'}
      </p>
      <ul class="listing listing-single">
        {#each results as m (m.recipe.slug)}
          <li class="result-row">
            <a href={`${base}recipes/${m.recipe.slug}/`}>
              <span>
                {m.recipe.title}
                {#if m.missing.length > 0}
                  <span class="ing-note">
                    missing {m.missing.map(nameOf).join(', ')}
                  </span>
                {:else}
                  <span class="ing-note">everything you need</span>
                {/if}
              </span>
              <span class="count">{Math.round(m.score * 100)}%</span>
            </a>
            {#if added.includes(m.recipe.slug)}
              <span class="result-added" role="status">
                In your <a href={`${base}plan/`}>plan</a>
              </span>
            {:else}
              <button class="result-add" onclick={() => add(m.recipe)}>Add to plan</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

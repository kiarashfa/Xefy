<script lang="ts">
  /**
   * "What can I make" — tick what you have, ranked by how close each dish is.
   *
   * Ranked by match percentage rather than a binary full-subset test, because
   * "you have five of six" is the useful answer and "no results" is not. Each
   * result names exactly what is missing.
   */
  interface Props {
    recipes: any[];
    ingredients: { id: string; name: string; category: string }[];
    staples: string[];
    base: string;
  }

  const { recipes, ingredients, staples, base }: Props = $props();

  const THRESHOLD = 0.5;

  let have = $state<string[]>([]);
  let filter = $state('');

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
        Nothing is within reach of that yet — with ten dishes on the site, that is more a comment on
        the catalogue than on your cupboard.
      </p>
    {:else}
      <p class="catalog-count">
        {results.length} within reach of {have.length} ingredient{have.length === 1 ? '' : 's'}
      </p>
      <ul class="listing" style="grid-template-columns:minmax(0,1fr)">
        {#each results as m (m.recipe.slug)}
          <li>
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
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

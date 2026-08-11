<script lang="ts">
  /**
   * The homepage catalogue: a photo-forward card grid by default, with a dense
   * sortable table for people who want to compare rather than browse.
   *
   * Both views read the same filtered and sorted list — one dataset, two
   * renderings, so they can never show different answers to the same question.
   */
  interface Term {
    id: string;
    label: string;
  }
  interface Props {
    recipes: any[];
    base: string;
    cuisines: readonly Term[];
    courses: readonly Term[];
    methods: readonly Term[];
    allergens: readonly Term[];
  }

  const { recipes, base, cuisines, courses, methods, allergens }: Props = $props();

  let view = $state<'grid' | 'table'>('grid');
  let query = $state('');
  let cuisine = $state<string[]>([]);
  let course = $state<string[]>([]);
  let method = $state<string[]>([]);
  let excludedAllergens = $state<string[]>([]);
  let sort = $state<'title' | 'totalMin' | 'kcalPerServing' | 'difficulty'>('title');

  const DIFFICULTY_ORDER = { Easy: 0, Medium: 1, Hard: 2 } as const;

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const minutes = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 || ''}`.trim());

  const shown = $derived(
    recipes
      .filter((r) => {
        // Style is matched by search rather than faceted: version labels are
        // free text and have no controlled vocabulary to build a menu from.
        const haystack = `${r.title} ${r.subtitle} ${r.style}`.toLowerCase();
        if (query && !haystack.includes(query.toLowerCase())) return false;
        if (cuisine.length && !cuisine.some((c) => r.tags.cuisine.includes(c))) return false;
        if (course.length && !course.some((c) => r.tags.course.includes(c))) return false;
        if (method.length && !method.some((c) => r.tags.method.includes(c))) return false;
        // Allergens are an exclusion filter, never an inclusion one.
        if (excludedAllergens.some((a) => r.allergens.includes(a))) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === 'title') return a.title.localeCompare(b.title);
        if (sort === 'difficulty')
          return DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty];
        return a[sort] - b[sort];
      }),
  );

  const facets = $derived([
    { label: 'Cuisine', terms: cuisines, selected: cuisine, set: (v: string[]) => (cuisine = v) },
    { label: 'Course', terms: courses, selected: course, set: (v: string[]) => (course = v) },
    { label: 'Method', terms: methods, selected: method, set: (v: string[]) => (method = v) },
  ]);

  const usedIds = $derived({
    cuisine: new Set(recipes.flatMap((r) => r.tags.cuisine)),
    course: new Set(recipes.flatMap((r) => r.tags.course)),
    method: new Set(recipes.flatMap((r) => r.tags.method)),
  });
</script>

<div class="catalog-controls">
  <input
    class="catalog-search"
    type="search"
    bind:value={query}
    placeholder="Search dishes, styles…"
    aria-label="Search the catalogue"
  />

  <div class="catalog-view">
    <button class:active={view === 'grid'} onclick={() => (view = 'grid')}>Cards</button>
    <button class:active={view === 'table'} onclick={() => (view = 'table')}>Table</button>
  </div>
</div>

<div class="catalog-facets">
  {#each facets as facet (facet.label)}
    <div class="facet">
      <span class="facet-label">{facet.label}</span>
      <div class="facet-terms">
        {#each facet.terms.filter((t) => usedIds[facet.label.toLowerCase() as 'cuisine'].has(t.id)) as term (term.id)}
          <button
            class="pill"
            class:on={facet.selected.includes(term.id)}
            aria-pressed={facet.selected.includes(term.id)}
            onclick={() => facet.set(toggle(facet.selected, term.id))}
          >
            {term.label}
          </button>
        {/each}
      </div>
    </div>
  {/each}

  <div class="facet">
    <span class="facet-label">Hide recipes containing</span>
    <div class="facet-terms">
      {#each allergens.filter((a) => recipes.some((r) => r.allergens.includes(a.id))) as term (term.id)}
        <button
          class="pill is-exclusion"
          class:on={excludedAllergens.includes(term.id)}
          aria-pressed={excludedAllergens.includes(term.id)}
          onclick={() => (excludedAllergens = toggle(excludedAllergens, term.id))}
        >
          {term.label}
        </button>
      {/each}
    </div>
  </div>
</div>

<p class="catalog-count">
  {shown.length} of {recipes.length}
  {#if view === 'table'}
    · sort
    <select bind:value={sort} aria-label="Sort by">
      <option value="title">Name</option>
      <option value="totalMin">Time</option>
      <option value="kcalPerServing">Calories</option>
      <option value="difficulty">Difficulty</option>
    </select>
  {/if}
</p>

{#if view === 'grid'}
  <ul class="card-grid">
    {#each shown as r (r.slug)}
      <li>
        <a class="card" href={`${base}recipes/${r.slug}/`}>
          <span class="card-image">
            {#if r.image}
              <img src={`${base}${r.image}`} alt="" width="800" height="800" loading="lazy" />
            {/if}
          </span>
          <span class="card-body">
            <span class="card-eyebrow">
              {cuisines.find((c) => c.id === r.tags.cuisine[0])?.label} · {r.style}
            </span>
            <span class="card-title">{r.title}</span>
            <span class="card-meta">{minutes(r.totalMin)} · {r.kcalPerServing} kcal · {r.difficulty}</span>
          </span>
        </a>
      </li>
    {/each}
  </ul>
{:else}
  <div class="table-scroll">
    <table class="catalog-table">
      <thead>
        <tr>
          <th>Name</th><th>Style</th><th>Cuisine</th><th>Course</th>
          <th>Time</th><th>kcal</th><th>Difficulty</th><th>Diet</th>
        </tr>
      </thead>
      <tbody>
        {#each shown as r (r.slug)}
          <tr>
            <td><a href={`${base}recipes/${r.slug}/`}>{r.title}</a></td>
            <td>{r.style}</td>
            <td>{r.tags.cuisine.map((c) => cuisines.find((x) => x.id === c)?.label).join(', ')}</td>
            <td>{r.tags.course.map((c) => courses.find((x) => x.id === c)?.label).join(', ')}</td>
            <td>{minutes(r.totalMin)}</td>
            <td>{r.kcalPerServing}</td>
            <td>{r.difficulty}</td>
            <td>{r.diets.join(', ') || '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if shown.length === 0}
  <p class="catalog-empty">Nothing matches those filters. Try removing one.</p>
{/if}

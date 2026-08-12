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

  import FacetMenu from './FacetMenu.svelte';

  const { recipes, base, cuisines, courses, methods, allergens }: Props = $props();

  let view = $state<'grid' | 'table'>('grid');
  let query = $state('');
  let cuisine = $state<string[]>([]);
  let course = $state<string[]>([]);
  let method = $state<string[]>([]);
  let excludedAllergens = $state<string[]>([]);

  /**
   * Sorting is a property of the list, not of the table.
   *
   * It used to appear only in the table view, which quietly said that anyone
   * browsing cards did not want an order — while the cards are exactly where
   * "quickest first" is a reasonable thing to ask for.
   */
  type SortKey = 'title' | 'title-desc' | 'totalMin' | 'kcalPerServing' | 'difficulty';
  let sort = $state<SortKey>('title');

  const SORTS: { id: SortKey; label: string }[] = [
    { id: 'title', label: 'Name A–Z' },
    { id: 'title-desc', label: 'Name Z–A' },
    { id: 'totalMin', label: 'Quickest first' },
    { id: 'kcalPerServing', label: 'Fewest calories' },
    { id: 'difficulty', label: 'Easiest first' },
  ];

  const DIFFICULTY_ORDER = { Easy: 0, Medium: 1, Hard: 2 } as const;

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
        if (sort === 'title-desc') return b.title.localeCompare(a.title);
        if (sort === 'difficulty')
          return (
            DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty] ||
            a.title.localeCompare(b.title)
          );
        return a[sort] - b[sort] || a.title.localeCompare(b.title);
      }),
  );

  /* Only terms with a dish behind them: a menu of empty filters wastes the
     reader's attention on answers that are all "nothing". */
  const used = $derived({
    cuisine: new Set(recipes.flatMap((r) => r.tags.cuisine)),
    course: new Set(recipes.flatMap((r) => r.tags.course)),
    method: new Set(recipes.flatMap((r) => r.tags.method)),
  });

  const facets = $derived([
    {
      key: 'Cuisine',
      terms: cuisines.filter((t) => used.cuisine.has(t.id)),
      selected: cuisine,
      set: (v: string[]) => (cuisine = v),
    },
    {
      key: 'Course',
      terms: courses.filter((t) => used.course.has(t.id)),
      selected: course,
      set: (v: string[]) => (course = v),
    },
    {
      key: 'Method',
      terms: methods.filter((t) => used.method.has(t.id)),
      selected: method,
      set: (v: string[]) => (method = v),
    },
  ]);

  const hideTerms = $derived(allergens.filter((a) => recipes.some((r) => r.allergens.includes(a.id))));

  const activeCount = $derived(
    cuisine.length + course.length + method.length + excludedAllergens.length + (query ? 1 : 0),
  );

  function clearAll() {
    query = '';
    cuisine = [];
    course = [];
    method = [];
    excludedAllergens = [];
  }
</script>

<!-- One row: everything that narrows the list, above the list it narrows. -->
<div class="catalog-bar">
  <input
    class="catalog-search"
    type="search"
    bind:value={query}
    placeholder="Search dishes, styles…"
    aria-label="Search the catalogue"
  />

  {#each facets as facet (facet.key)}
    <FacetMenu
      label={facet.key}
      terms={facet.terms}
      selected={facet.selected}
      onchange={facet.set}
    />
  {/each}

  {#if hideTerms.length > 0}
    <FacetMenu
      label="Hide"
      terms={hideTerms}
      selected={excludedAllergens}
      onchange={(v) => (excludedAllergens = v)}
      exclusion
    />
  {/if}

  <label class="catalog-sort">
    <span class="visually-hidden">Sort by</span>
    <select bind:value={sort}>
      {#each SORTS as s (s.id)}
        <option value={s.id}>{s.label}</option>
      {/each}
    </select>
  </label>

  <div class="catalog-view">
    <button class:active={view === 'grid'} onclick={() => (view = 'grid')}>Cards</button>
    <button class:active={view === 'table'} onclick={() => (view = 'table')}>Table</button>
  </div>
</div>

<p class="catalog-count">
  {shown.length} of {recipes.length}
  {#if activeCount > 0}
    · <button class="catalog-clear" onclick={clearAll}>Clear filters</button>
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
        <!-- Diet is gone: three or four labels per row made it the widest
             column on the table, for a fact the filters already act on. -->
        <tr>
          <th>Name</th><th>Style</th><th>Cuisine</th><th>Course</th>
          <th>Time</th><th>kcal</th><th>Difficulty</th>
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
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if shown.length === 0}
  <p class="catalog-empty">Nothing matches those filters. Try removing one.</p>
{/if}

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
   *
   * The name sort and the numeric ones are separate controls because they are
   * different questions. Direction belongs to the numeric one: a single list
   * mixing "Name A–Z" with "Fewest calories" can only offer one direction per
   * entry and doubles in length the moment both are wanted.
   */
  type SortField = 'title' | 'totalMin' | 'kcalPerServing' | 'difficulty';
  let sortField = $state<SortField>('title');
  let sortDesc = $state(false);

  const SORT_FIELDS: { id: SortField; label: string; low: string; high: string }[] = [
    { id: 'title', label: 'Name', low: 'A–Z', high: 'Z–A' },
    { id: 'totalMin', label: 'Time', low: 'Quickest', high: 'Longest' },
    { id: 'kcalPerServing', label: 'Calories', low: 'Fewest', high: 'Most' },
    { id: 'difficulty', label: 'Difficulty', low: 'Easiest', high: 'Hardest' },
  ];

  const activeSort = $derived(SORT_FIELDS.find((s) => s.id === sortField)!);

  const DIFFICULTY_ORDER = { Easy: 0, Medium: 1, Hard: 2 } as const;

  /**
   * Ceilings on the three computed figures — "nothing over 600 kcal", "under
   * half an hour".
   *
   * A number the reader types, not a bucket somebody chose for them: any fixed
   * set of ranges is wrong for most people, and every one of these figures is
   * already computed per recipe, so there is nothing to estimate.
   */
  let maxMinutes = $state<number | null>(null);
  let maxKcal = $state<number | null>(null);
  let maxDifficulty = $state<'' | 'Easy' | 'Medium' | 'Hard'>('');

  const limitCount = $derived(
    (maxMinutes != null ? 1 : 0) + (maxKcal != null ? 1 : 0) + (maxDifficulty ? 1 : 0),
  );

  const num = (v: string): number | null => {
    const n = Number(v);
    return v.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n;
  };

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
        if (maxMinutes != null && r.totalMin > maxMinutes) return false;
        if (maxKcal != null && r.kcalPerServing > maxKcal) return false;
        if (maxDifficulty && DIFFICULTY_ORDER[r.difficulty] > DIFFICULTY_ORDER[maxDifficulty])
          return false;
        return true;
      })
      .sort((a, b) => {
        const dir = sortDesc ? -1 : 1;
        if (sortField === 'title') return dir * a.title.localeCompare(b.title);
        const key =
          sortField === 'difficulty'
            ? DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]
            : a[sortField] - b[sortField];
        // Ties fall back to the name, so the order is stable and readable
        // rather than whatever the source array happened to be in.
        return dir * key || a.title.localeCompare(b.title);
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
    cuisine.length +
      course.length +
      method.length +
      excludedAllergens.length +
      limitCount +
      (query ? 1 : 0),
  );

  function clearAll() {
    query = '';
    cuisine = [];
    course = [];
    method = [];
    excludedAllergens = [];
    maxMinutes = null;
    maxKcal = null;
    maxDifficulty = '';
  }

  /* The limits panel dismisses the same way a facet menu does. */
  let limitsOpen = $state(false);
  let limitsRoot = $state<HTMLElement | null>(null);
  let limitsButton = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (!limitsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (limitsRoot && !limitsRoot.contains(e.target as Node)) limitsOpen = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        limitsOpen = false;
        limitsButton?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });
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

  <!-- Ceilings on the computed figures. A typed number, not a chosen bucket. -->
  <div class="facet-menu" bind:this={limitsRoot}>
    <button
      class="facet-menu-button"
      class:on={limitCount > 0}
      bind:this={limitsButton}
      aria-expanded={limitsOpen}
      aria-haspopup="true"
      onclick={() => (limitsOpen = !limitsOpen)}
    >
      Limits
      {#if limitCount > 0}<span class="facet-menu-count">{limitCount}</span>{/if}
      <span class="facet-menu-caret" aria-hidden="true">▾</span>
    </button>

    {#if limitsOpen}
      <div class="facet-menu-panel is-limits" role="group" aria-label="Limits">
        <label class="limit-row">
          <span>Time at most</span>
          <span class="limit-input">
            <input
              type="number"
              min="1"
              step="5"
              inputmode="numeric"
              placeholder="any"
              value={maxMinutes ?? ''}
              oninput={(e) => (maxMinutes = num(e.currentTarget.value))}
            />
            <span class="limit-unit">min</span>
          </span>
        </label>

        <label class="limit-row">
          <span>Calories at most</span>
          <span class="limit-input">
            <input
              type="number"
              min="1"
              step="50"
              inputmode="numeric"
              placeholder="any"
              value={maxKcal ?? ''}
              oninput={(e) => (maxKcal = num(e.currentTarget.value))}
            />
            <span class="limit-unit">kcal</span>
          </span>
        </label>

        <label class="limit-row">
          <span>Difficulty at most</span>
          <select bind:value={maxDifficulty}>
            <option value="">any</option>
            <option value="Easy">Easy</option>
            <option value="Medium">Medium</option>
            <option value="Hard">Hard</option>
          </select>
        </label>

        <p class="limit-note">Calories are per serving, and time is the whole dish.</p>

        {#if limitCount > 0}
          <button
            class="facet-menu-clear"
            onclick={() => {
              maxMinutes = null;
              maxKcal = null;
              maxDifficulty = '';
            }}
          >
            Clear limits
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <label class="catalog-sort">
    <span class="visually-hidden">Sort by</span>
    <select bind:value={sortField}>
      {#each SORT_FIELDS as s (s.id)}
        <option value={s.id}>{s.label}</option>
      {/each}
    </select>
  </label>

  <!-- Direction is its own control, so every field can go both ways. -->
  <button
    class="sort-dir"
    aria-pressed={sortDesc}
    onclick={() => (sortDesc = !sortDesc)}
    title={`Sorted by ${activeSort.label.toLowerCase()}: ${sortDesc ? activeSort.high : activeSort.low} first`}
  >
    <span aria-hidden="true">{sortDesc ? '↓' : '↑'}</span>
    {sortDesc ? activeSort.high : activeSort.low}
  </button>

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

<script lang="ts">
  /**
   * The full catalogue: a photo-forward card grid by default, with a dense
   * table for people who want to compare rather than browse.
   *
   * Both views read the same filtered and sorted list — one dataset, two
   * renderings, so they can never show different answers to the same question.
   *
   * Built for a catalogue in the thousands, not the hundreds:
   *
   * - The page server-renders only the first page of dishes (`initial`), so the
   *   HTML stays small however large the catalogue grows. The whole list is the
   *   light export, `catalog-index.json`, fetched once on load; until it
   *   arrives the controls work on what is already there.
   * - Results are shown a page at a time behind "Show more", never all at
   *   once: a grid of two thousand cards is a page nobody can reach the end of.
   * - Every filter, the sort and the view live in the address bar, so any view
   *   is a link, and Back undoes a change.
   */
  import { onMount } from 'svelte';
  import FacetMenu from './FacetMenu.svelte';

  interface Term {
    id: string;
    label: string;
  }
  interface Props {
    /** The first page, server-rendered. */
    initial: any[];
    /** How many dishes the full list holds, for the count before it loads. */
    total: number;
    /** Base-aware URL of the light catalogue export. */
    src: string;
    base: string;
    cuisines: readonly Term[];
    courses: readonly Term[];
    methods: readonly Term[];
    allergens: readonly Term[];
  }

  const { initial, total, src, base, cuisines, courses, methods, allergens }: Props = $props();

  const PAGE = 48;

  let recipes = $state<any[]>(initial);
  let loadState = $state<'loading' | 'ready' | 'failed'>('loading');

  let view = $state<'grid' | 'table'>('grid');
  let query = $state('');
  let cuisine = $state<string[]>([]);
  let course = $state<string[]>([]);
  let method = $state<string[]>([]);
  let diet = $state<string[]>([]);
  let excludedAllergens = $state<string[]>([]);
  let limit = $state(PAGE);

  /**
   * Sorting is a property of the list, not of the table.
   *
   * The name sort and the numeric ones are separate controls because they are
   * different questions. Direction belongs to the numeric one: a single list
   * mixing "Name A–Z" with "Fewest calories" can only offer one direction per
   * entry and doubles in length the moment both are wanted.
   */
  type SortField = 'title' | 'style' | 'cuisine' | 'course' | 'totalMin' | 'kcalPerServing' | 'difficulty';
  let sortField = $state<SortField>('title');
  let sortDesc = $state(false);

  const SORT_FIELDS: { id: SortField; label: string; low: string; high: string }[] = [
    { id: 'title', label: 'Name', low: 'A–Z', high: 'Z–A' },
    { id: 'style', label: 'Style', low: 'A–Z', high: 'Z–A' },
    { id: 'cuisine', label: 'Cuisine', low: 'A–Z', high: 'Z–A' },
    { id: 'course', label: 'Course', low: 'A–Z', high: 'Z–A' },
    { id: 'totalMin', label: 'Time', low: 'Quickest', high: 'Longest' },
    { id: 'kcalPerServing', label: 'Calories', low: 'Fewest', high: 'Most' },
    { id: 'difficulty', label: 'Difficulty', low: 'Easiest', high: 'Hardest' },
  ];

  const activeSort = $derived(SORT_FIELDS.find((s) => s.id === sortField)!);

  const DIFFICULTY_ORDER = { Easy: 0, Medium: 1, Hard: 2 } as const;

  /**
   * Ceilings on the three computed figures — "nothing over 600 kcal", "under
   * half an hour". A number the reader types, not a bucket somebody chose for
   * them: every one of these figures is already computed per recipe.
   */
  let maxMinutes = $state<number | null>(null);
  let maxKcal = $state<number | null>(null);
  let maxDifficulty = $state<'' | 'Easy' | 'Medium' | 'Hard'>('');

  const limitCount = $derived(
    (maxMinutes != null ? 1 : 0) + (maxKcal != null ? 1 : 0) + (maxDifficulty ? 1 : 0),
  );

  const num = (v: string | null): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return v.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n;
  };

  const minutes = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 || ''}`.trim());

  /** Alphabetical, because a named vocabulary has no other order a reader can predict. */
  const byLabel = (list: readonly Term[]) => [...list].sort((a, b) => a.label.localeCompare(b.label));

  type Axis = 'query' | 'cuisine' | 'course' | 'method' | 'diet' | 'hide' | 'limits';

  /** Every active filter, optionally ignoring one axis (for that axis's own counts). */
  function passes(r: any, skip?: Axis): boolean {
    if (skip !== 'query' && query) {
      // Style is matched by search rather than faceted: version labels are
      // free text and have no controlled vocabulary to build a menu from.
      const haystack = `${r.title} ${r.subtitle} ${r.style}`.toLowerCase();
      if (!haystack.includes(query.toLowerCase())) return false;
    }
    if (skip !== 'cuisine' && cuisine.length && !cuisine.some((c) => r.tags.cuisine.includes(c))) return false;
    if (skip !== 'course' && course.length && !course.some((c) => r.tags.course.includes(c))) return false;
    if (skip !== 'method' && method.length && !method.some((c) => r.tags.method.includes(c))) return false;
    // Diets are requirements, so every chosen one must hold: vegan AND gluten-free.
    if (skip !== 'diet' && diet.length && !diet.every((d) => r.diets.includes(d))) return false;
    // Allergens are an exclusion filter, never an inclusion one.
    if (skip !== 'hide' && excludedAllergens.some((a) => r.allergens.includes(a))) return false;
    if (skip !== 'limits') {
      if (maxMinutes != null && r.totalMin > maxMinutes) return false;
      if (maxKcal != null && r.kcalPerServing > maxKcal) return false;
      if (maxDifficulty && DIFFICULTY_ORDER[r.difficulty as keyof typeof DIFFICULTY_ORDER] > DIFFICULTY_ORDER[maxDifficulty])
        return false;
    }
    return true;
  }

  const shown = $derived(
    recipes
      .filter((r) => passes(r))
      .sort((a, b) => {
        const dir = sortDesc ? -1 : 1;
        if (sortField === 'title') return dir * a.title.localeCompare(b.title);
        if (sortField === 'style' || sortField === 'cuisine' || sortField === 'course')
          return dir * textOf(a, sortField).localeCompare(textOf(b, sortField)) || a.title.localeCompare(b.title);
        const key =
          sortField === 'difficulty'
            ? DIFFICULTY_ORDER[a.difficulty as keyof typeof DIFFICULTY_ORDER] -
              DIFFICULTY_ORDER[b.difficulty as keyof typeof DIFFICULTY_ORDER]
            : a[sortField] - b[sortField];
        // Ties fall back to the name, so the order is stable and readable.
        return dir * key || a.title.localeCompare(b.title);
      }),
  );

  const windowed = $derived(shown.slice(0, limit));

  /** The text a text column shows, which is also what it sorts by. */
  function textOf(r: any, field: 'style' | 'cuisine' | 'course'): string {
    if (field === 'style') return r.style ?? '';
    if (field === 'cuisine') return r.tags.cuisine.map(cuisineLabel).join(', ');
    return r.tags.course.map(courseLabel).join(', ');
  }

  /** The table's columns; each header sorts by its column, a second click reverses. */
  const COLUMNS: { field: SortField; label: string }[] = [
    { field: 'title', label: 'Name' },
    { field: 'style', label: 'Style' },
    { field: 'cuisine', label: 'Cuisine' },
    { field: 'course', label: 'Course' },
    { field: 'totalMin', label: 'Time' },
    { field: 'kcalPerServing', label: 'kcal' },
    { field: 'difficulty', label: 'Difficulty' },
  ];
  function sortBy(field: SortField) {
    sortDesc = sortField === field ? !sortDesc : false;
    sortField = field;
  }

  /** How many dishes each term would leave, given every other filter. */
  function countsFor(axis: 'cuisine' | 'course' | 'method'): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of recipes) {
      if (!passes(r, axis)) continue;
      for (const t of r.tags[axis]) out[t] = (out[t] ?? 0) + 1;
    }
    return out;
  }

  /** The same, for the computed diet labels, which live beside the tags. */
  function dietCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of recipes) {
      if (!passes(r, 'diet')) continue;
      for (const d of r.diets) out[d] = (out[d] ?? 0) + 1;
    }
    return out;
  }
  const dietLabel = (id: string) => id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const dietTerms = $derived(
    [...new Set(recipes.flatMap((r) => r.diets as string[]))].map((id) => ({ id, label: dietLabel(id) })),
  );

  /* Only terms with a dish behind them: a menu of empty filters wastes the
     reader's attention on answers that are all "nothing". */
  const used = $derived({
    cuisine: new Set(recipes.flatMap((r) => r.tags.cuisine)),
    course: new Set(recipes.flatMap((r) => r.tags.course)),
    method: new Set(recipes.flatMap((r) => r.tags.method)),
  });

  const facets = $derived([
    // The same order as the table's columns; the filters with no column follow.
    {
      key: 'Cuisine',
      terms: byLabel(cuisines.filter((t) => used.cuisine.has(t.id))),
      counts: countsFor('cuisine'),
      selected: cuisine,
      set: (v: string[]) => (cuisine = v),
    },
    {
      key: 'Course',
      terms: byLabel(courses.filter((t) => used.course.has(t.id))),
      counts: countsFor('course'),
      selected: course,
      set: (v: string[]) => (course = v),
    },
    {
      key: 'Method',
      terms: byLabel(methods.filter((t) => used.method.has(t.id))),
      counts: countsFor('method'),
      selected: method,
      set: (v: string[]) => (method = v),
    },
    {
      key: 'Diet',
      terms: byLabel(dietTerms),
      counts: dietCounts(),
      selected: diet,
      set: (v: string[]) => (diet = v),
    },
  ]);

  const hideTerms = $derived(byLabel(allergens.filter((a) => recipes.some((r) => r.allergens.includes(a.id)))));
  const hideCounts = $derived.by(() => {
    const out: Record<string, number> = {};
    for (const r of recipes) {
      if (!passes(r, 'hide')) continue;
      for (const a of r.allergens) out[a] = (out[a] ?? 0) + 1;
    }
    return out;
  });

  const activeCount = $derived(
    cuisine.length + course.length + method.length + diet.length + excludedAllergens.length + limitCount + (query ? 1 : 0),
  );

  function clearAll() {
    query = '';
    cuisine = [];
    course = [];
    method = [];
    diet = [];
    excludedAllergens = [];
    maxMinutes = null;
    maxKcal = null;
    maxDifficulty = '';
  }

  /* A changed question starts again at the top of its answer. */
  $effect(() => {
    void [query, cuisine, course, method, diet, excludedAllergens, maxMinutes, maxKcal, maxDifficulty, sortField, sortDesc];
    limit = PAGE;
  });

  /* ── The address bar ─────────────────────────────────────────────────── */

  const VIEW_KEY = 'xefy.catalog.view.v1';
  let urlReady = $state(false);

  function readUrl() {
    const p = new URLSearchParams(location.search);
    const list = (k: string) => (p.get(k) ?? '').split(',').filter(Boolean);
    query = p.get('q') ?? '';
    cuisine = list('cuisine');
    course = list('course');
    method = list('method');
    diet = list('diet');
    excludedAllergens = list('hide');
    maxMinutes = num(p.get('time'));
    maxKcal = num(p.get('kcal'));
    const d = p.get('diff');
    maxDifficulty = d === 'Easy' || d === 'Medium' || d === 'Hard' ? d : '';
    const s = p.get('sort');
    sortField = SORT_FIELDS.some((f) => f.id === s) ? (s as SortField) : 'title';
    sortDesc = p.get('dir') === 'desc';
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(VIEW_KEY);
    } catch {}
    view = p.get('view') === 'table' || (!p.get('view') && stored === 'table') ? 'table' : 'grid';
  }

  $effect(() => {
    if (!urlReady) return;
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (cuisine.length) p.set('cuisine', cuisine.join(','));
    if (course.length) p.set('course', course.join(','));
    if (method.length) p.set('method', method.join(','));
    if (diet.length) p.set('diet', diet.join(','));
    if (excludedAllergens.length) p.set('hide', excludedAllergens.join(','));
    if (maxMinutes != null) p.set('time', String(maxMinutes));
    if (maxKcal != null) p.set('kcal', String(maxKcal));
    if (maxDifficulty) p.set('diff', maxDifficulty);
    if (sortField !== 'title') p.set('sort', sortField);
    if (sortDesc) p.set('dir', 'desc');
    if (view === 'table') p.set('view', 'table');
    const qs = p.toString();
    const next = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
    if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, '', next);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {}
  });

  onMount(() => {
    readUrl();
    urlReady = true;
    fetch(src)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: any[]) => {
        recipes = data;
        loadState = 'ready';
      })
      .catch(() => (loadState = 'failed'));
  });

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

  const cuisineLabel = (id: string) => cuisines.find((c) => c.id === id)?.label ?? id;
  const courseLabel = (id: string) => courses.find((c) => c.id === id)?.label ?? id;
</script>

<!-- The console: a header line saying what is shown and what is filtering it,
     then two rows, each filled edge to edge: the tools that shape the list, and
     the list menus that narrow it, in the table's column order with exclusion
     last. -->
<section class="catalog-bar" aria-label="Filter the catalogue">
  <div class="catalog-head">
    <span class="catalog-title">Filter</span>
    <p class="catalog-count" aria-live="polite">
      {#if loadState === 'loading'}
        Showing {windowed.length} of {total} dishes · loading the rest…
      {:else if loadState === 'failed'}
        The full list could not be loaded; these are the first {recipes.length} of {total} dishes.
      {:else}
        {shown.length === recipes.length ? `${shown.length} dishes` : `${shown.length} of ${recipes.length} dishes`}
      {/if}
    </p>
    {#if activeCount > 0}
      <div class="catalog-active">
        {#if query}<button class="catalog-chip" onclick={() => (query = '')}>“{query}” <span aria-hidden="true">×</span></button>{/if}
        {#each cuisine as id (id)}<button class="catalog-chip" onclick={() => (cuisine = cuisine.filter((x) => x !== id))}>{cuisineLabel(id)} <span aria-hidden="true">×</span></button>{/each}
        {#each course as id (id)}<button class="catalog-chip" onclick={() => (course = course.filter((x) => x !== id))}>{courseLabel(id)} <span aria-hidden="true">×</span></button>{/each}
        {#each method as id (id)}<button class="catalog-chip" onclick={() => (method = method.filter((x) => x !== id))}>{methods.find((m) => m.id === id)?.label ?? id} <span aria-hidden="true">×</span></button>{/each}
        {#each diet as id (id)}<button class="catalog-chip" onclick={() => (diet = diet.filter((x) => x !== id))}>{dietLabel(id)} <span aria-hidden="true">×</span></button>{/each}
        {#each excludedAllergens as id (id)}<button class="catalog-chip is-exclusion" onclick={() => (excludedAllergens = excludedAllergens.filter((x) => x !== id))}>No {allergens.find((a) => a.id === id)?.label.toLowerCase() ?? id} <span aria-hidden="true">×</span></button>{/each}
        {#if limitCount > 0}<button class="catalog-chip" onclick={() => { maxMinutes = null; maxKcal = null; maxDifficulty = ''; }}>Limits <span aria-hidden="true">×</span></button>{/if}
        <button class="catalog-clear" onclick={clearAll}>Clear all</button>
      </div>
    {/if}
  </div>

  <div class="catalog-body">
    <div class="catalog-row">
      <input
        class="catalog-search"
        type="search"
        bind:value={query}
        placeholder="Search dishes, styles…"
        aria-label="Search the catalogue"
      />

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
        <button class:active={view === 'grid'} aria-pressed={view === 'grid'} onclick={() => (view = 'grid')}>Cards</button>
        <button class:active={view === 'table'} aria-pressed={view === 'table'} onclick={() => (view = 'table')}>Table</button>
      </div>
    </div>

    <div class="catalog-row catalog-menus" style={`--menus: ${facets.length + (hideTerms.length > 0 ? 1 : 0)}`}>
      {#each facets as facet (facet.key)}
        <FacetMenu
          label={facet.key}
          terms={facet.terms}
          counts={facet.counts}
          selected={facet.selected}
          onchange={facet.set}
        />
      {/each}

      {#if hideTerms.length > 0}
        <FacetMenu
          label="Hide"
          terms={hideTerms}
          counts={hideCounts}
          selected={excludedAllergens}
          onchange={(v) => (excludedAllergens = v)}
          exclusion
        />
      {/if}
    </div>
  </div>
</section>

{#if view === 'grid'}
  <ul class="card-grid">
    {#each windowed as r (r.slug)}
      <li>
        <a class="card" href={`${base}recipes/${r.slug}/`}>
          <span class="card-image">
            {#if r.image}
              <img src={`${base}${r.image}`} alt="" width="800" height="800" loading="lazy" />
            {/if}
          </span>
          <span class="card-body">
            <span class="card-eyebrow">
              {cuisineLabel(r.tags.cuisine[0])} · {r.style}
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
          {#each COLUMNS as c (c.field)}
            <th aria-sort={sortField === c.field ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
              <button type="button" class="th-sort" onclick={() => sortBy(c.field)}>
                {c.label}<span class="th-dir" aria-hidden="true"></span>
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each windowed as r (r.slug)}
          <tr>
            <td><a href={`${base}recipes/${r.slug}/`}>{r.title}</a></td>
            <td>{r.style}</td>
            <td>{r.tags.cuisine.map(cuisineLabel).join(', ')}</td>
            <td>{r.tags.course.map(courseLabel).join(', ')}</td>
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
{:else if shown.length > windowed.length}
  <div class="catalog-more">
    <button class="catalog-more-button" onclick={() => (limit += PAGE)}>
      Show {Math.min(PAGE, shown.length - windowed.length)} more
    </button>
    <span>{windowed.length} of {shown.length} shown</span>
  </div>
{/if}

<script lang="ts">
  /**
   * One multi-select dropdown in the catalogue's control row.
   *
   * A row of pills per facet was honest and did not survive contact with a
   * growing catalogue: thirty cuisines is three wrapped lines before a single
   * dish is visible, and the controls pushed the thing being controlled off the
   * screen. A menu keeps the row one line however many terms there are, and the
   * list inside it scrolls on its own, so seventy cuisines cost the page
   * nothing.
   *
   * Built from a button and a panel rather than a native `<select multiple>`,
   * which cannot show a count, cannot be cleared in one action, and renders as
   * a scrolling list box that looks nothing like the rest of this page. The
   * cost of that choice is the keyboard and focus behaviour a native control
   * would have given free, so it is all here: Escape closes, focus returning to
   * the button, and a click outside dismissing.
   *
   * Terms arrive already ordered; the catalogue decides the order (alphabetical
   * for a named vocabulary). A count beside each term says how many dishes it
   * would leave, given every OTHER filter already applied, so a choice that
   * would empty the list is visible before it is made.
   */
  interface Term {
    id: string;
    label: string;
  }

  interface Props {
    label: string;
    terms: readonly Term[];
    selected: string[];
    onchange: (next: string[]) => void;
    /** Per-term result counts. Omitted, no counts are shown. */
    counts?: Record<string, number>;
    /** Exclusion filters are a different action and are coloured as one. */
    exclusion?: boolean;
  }

  const { label, terms, selected, onchange, counts, exclusion = false }: Props = $props();

  /** Past this many terms a list is searched, not scanned. */
  const SEARCH_FROM = 10;

  let open = $state(false);
  let filter = $state('');
  let root = $state<HTMLElement | null>(null);
  let button = $state<HTMLButtonElement | null>(null);

  const visible = $derived(
    filter.trim() === ''
      ? terms
      : terms.filter((t) => t.label.toLowerCase().includes(filter.trim().toLowerCase())),
  );

  const toggle = (id: string) =>
    onchange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  function close(refocus = false) {
    open = false;
    filter = '';
    if (refocus) button?.focus();
  }

  $effect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="facet-menu" bind:this={root}>
  <button
    class="facet-menu-button"
    class:on={selected.length > 0}
    class:is-exclusion={exclusion}
    bind:this={button}
    aria-expanded={open}
    aria-haspopup="true"
    onclick={() => (open ? close() : (open = true))}
  >
    {label}
    {#if selected.length > 0}<span class="facet-menu-count">{selected.length}</span>{/if}
    <span class="facet-menu-caret" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="facet-menu-panel" role="group" aria-label={label}>
      {#if terms.length > SEARCH_FROM}
        <input
          class="facet-menu-search"
          type="search"
          placeholder={`Find a ${label.toLowerCase()}`}
          aria-label={`Find a ${label.toLowerCase()}`}
          bind:value={filter}
        />
      {/if}
      <ul class="facet-menu-list">
        {#each visible as term (term.id)}
          {@const n = counts?.[term.id]}
          <li>
            <label class:is-empty={n === 0 && !selected.includes(term.id)}>
              <input
                type="checkbox"
                class="chk"
                checked={selected.includes(term.id)}
                onchange={() => toggle(term.id)}
              />
              <span class="facet-menu-label">{term.label}</span>
              {#if n !== undefined}<span class="facet-menu-n">{n}</span>{/if}
            </label>
          </li>
        {:else}
          <li class="facet-menu-none">No {label.toLowerCase()} matches “{filter}”.</li>
        {/each}
      </ul>
      {#if selected.length > 0}
        <button class="facet-menu-clear" onclick={() => onchange([])}>Clear {label.toLowerCase()}</button>
      {/if}
    </div>
  {/if}
</div>

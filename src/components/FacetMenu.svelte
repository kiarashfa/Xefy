<script lang="ts">
  /**
   * One multi-select dropdown in the catalogue's control row.
   *
   * A row of pills per facet was honest and did not survive contact with a
   * growing catalogue: thirty cuisines is three wrapped lines before a single
   * dish is visible, and the controls pushed the thing being controlled off the
   * screen. A menu keeps the row one line however many terms there are.
   *
   * Built from a button and a panel rather than a native `<select multiple>`,
   * which cannot show a count, cannot be cleared in one action, and renders as
   * a scrolling list box that looks nothing like the rest of this page. The
   * cost of that choice is the keyboard and focus behaviour a native control
   * would have given free, so it is all here: Escape closes, focus returning to
   * the button, and a click outside dismissing.
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
    /** Exclusion filters are a different action and are coloured as one. */
    exclusion?: boolean;
  }

  const { label, terms, selected, onchange, exclusion = false }: Props = $props();

  let open = $state(false);
  let root = $state<HTMLElement | null>(null);
  let button = $state<HTMLButtonElement | null>(null);

  const toggle = (id: string) =>
    onchange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  function close(refocus = false) {
    open = false;
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
    onclick={() => (open = !open)}
  >
    {label}
    {#if selected.length > 0}<span class="facet-menu-count">{selected.length}</span>{/if}
    <span class="facet-menu-caret" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="facet-menu-panel" role="group" aria-label={label}>
      <ul>
        {#each terms as term (term.id)}
          <li>
            <label>
              <input
                type="checkbox"
                class="chk"
                checked={selected.includes(term.id)}
                onchange={() => toggle(term.id)}
              />
              <span>{term.label}</span>
            </label>
          </li>
        {/each}
      </ul>
      {#if selected.length > 0}
        <button class="facet-menu-clear" onclick={() => onchange([])}>Clear {label}</button>
      {/if}
    </div>
  {/if}
</div>

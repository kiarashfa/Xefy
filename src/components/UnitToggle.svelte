<script lang="ts">
  import { restoreUnitSystem, setUnitSystem, unitSystem } from '../lib/stores/display.ts';
  import type { UnitSystem } from '../lib/math/units.ts';

  restoreUnitSystem();

  const options: { value: UnitSystem; label: string }[] = [
    { value: 'metric', label: 'Metric' },
    { value: 'us', label: 'US' },
  ];
</script>

<div class="unit-toggle" role="group" aria-label="Measurement units">
  {#each options as option (option.value)}
    <button
      type="button"
      class:active={$unitSystem === option.value}
      aria-pressed={$unitSystem === option.value}
      onclick={() => setUnitSystem(option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .unit-toggle {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--surface-3);
    border: 1px solid var(--line);
    border-radius: 100px;
  }

  button {
    border: none;
    background: transparent;
    padding: 6px 13px;
    border-radius: 100px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--muted);
    cursor: pointer;
    transition:
      background 0.35s var(--ease),
      color 0.35s var(--ease);
  }

  button.active {
    background: var(--accent);
    /* The accent's paired foreground, so this stays legible in both themes. */
    color: var(--surface-3);
  }

  /*
   * On paper the control becomes its own answer: the inactive option goes and
   * the active one reads as plain text. It lives here rather than in
   * print.css because a scoped component style beats a global one, so the
   * global sheet cannot undo what this block sets. §19.10
   */
  @media print {
    .unit-toggle {
      border: none;
      padding: 0;
      background: none;
    }

    button {
      display: none;
    }

    button.active {
      display: inline;
      background: none;
      color: var(--ink);
      font-family: var(--font-display);
      font-size: 12pt;
      padding: 0;
    }
  }
</style>

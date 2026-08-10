<script lang="ts">
  import { restoreServings, servings, setServings } from '../lib/stores/display.ts';

  interface Props {
    /** Serving counts are remembered per dish. */
    recipe: string;
    defaultServings: number;
    min?: number;
    max?: number;
  }

  const { recipe, defaultServings, min = 1, max = 24 }: Props = $props();

  // Idempotent: the shared live-values script does this too, and whichever
  // arrives first settles it. The store starts at zero so the fallback is
  // visible until then, which is the same number the server rendered.
  restoreServings(recipe, defaultServings);

  const current = $derived($servings || defaultServings);

  const step = (delta: number) =>
    setServings(recipe, Math.min(max, Math.max(min, current + delta)));
</script>

<div class="stepper">
  <button
    type="button"
    onclick={() => step(-1)}
    disabled={current <= min}
    aria-label="One fewer serving"
  >
    −
  </button>
  <span class="count" aria-live="polite" aria-label="{current} servings">{current}</span>
  <button
    type="button"
    onclick={() => step(1)}
    disabled={current >= max}
    aria-label="One more serving"
  >
    +
  </button>
</div>

<style>
  .stepper {
    display: flex;
    align-items: center;
    border: 1px solid var(--line-strong);
    border-radius: 100px;
    background: var(--surface-3);
  }

  button {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    font-family: var(--font-display);
    font-size: 15px;
    color: var(--ink);
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.35s var(--ease);
  }

  button:hover:not(:disabled) {
    background: var(--accent-soft);
  }

  button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .count {
    width: 30px;
    text-align: center;
    font-family: var(--font-display);
    font-size: 16px;
  }
</style>

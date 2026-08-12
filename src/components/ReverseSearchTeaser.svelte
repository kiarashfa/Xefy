<script lang="ts">
  /**
   * The homepage entry point into "what can I make" — §8.2.
   *
   * The catalogue answers "what is there"; this answers "what can I cook
   * tonight", which is a different question with a different control. Rather
   * than describe that in a banner, the teaser *is* the control: a few of the
   * ingredients the catalogue leans on most, ticked here and carried through.
   *
   * The selection travels in the URL fragment rather than in storage. It is a
   * handoff between two pages, not a preference worth remembering, and a
   * fragment costs nothing, survives a bookmark and cannot outlive its welcome.
   */
  interface Props {
    ingredients: { id: string; name: string }[];
    base: string;
  }

  const { ingredients, base }: Props = $props();

  let have = $state<string[]>([]);

  const toggle = (id: string) =>
    (have = have.includes(id) ? have.filter((x) => x !== id) : [...have, id]);

  const href = $derived(
    have.length === 0
      ? `${base}what-can-i-make/`
      : `${base}what-can-i-make/#have=${have.join(',')}`,
  );
</script>

<section class="teaser" aria-labelledby="teaser-title">
  <h2 class="teaser-title" id="teaser-title">Or start from what you have</h2>
  <p class="teaser-lede">
    Tick a few of these and carry them through — dishes are ranked by how close each one is, and
    every result names exactly what is missing.
  </p>

  <div class="facet-terms">
    {#each ingredients as i (i.id)}
      <button
        type="button"
        class="pill"
        class:on={have.includes(i.id)}
        aria-pressed={have.includes(i.id)}
        onclick={() => toggle(i.id)}
      >
        {i.name}
      </button>
    {/each}
  </div>

  <a class="teaser-go" {href}>
    {have.length === 0 ? 'Open the full ingredient list' : `Find dishes from these ${have.length}`}
    <span aria-hidden="true">→</span>
  </a>
</section>

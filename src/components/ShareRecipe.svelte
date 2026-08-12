<script lang="ts">
  /**
   * Sharing a dish.
   *
   * The only thing on this site somebody might reasonably put in front of an
   * audience, so this is the one place the *post* intents belong — a shopping
   * list gets sent to a person, a dish gets shown to people. Pinterest is worth
   * having here and nowhere else: it wants a picture and a link, which is
   * exactly what a recipe page is.
   *
   * Collapsed by default. It is a secondary action on a page whose job is to be
   * cooked from, and an open row of six logos beside the method would be the
   * loudest thing on it.
   */
  import ShareTargets from './ShareTargets.svelte';

  interface Props {
    title: string;
    subtitle: string;
    /** Absolute, so the intent has something to point at. */
    url: string;
    image?: string;
  }

  const { title, subtitle, url, image = '' }: Props = $props();

  let open = $state(false);
  let copied = $state('');

  const body = $derived(`${title} — ${subtitle}`);
  const text = $derived(`${body}\n${url}`);

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function share() {
    try {
      await navigator.share({ title, text: body, url });
    } catch {
      // A cancelled share is the ordinary case and is not an error.
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      copied = 'Link copied.';
    } catch {
      copied = 'This browser would not let the page copy for you.';
    }
  }
</script>

<div class="side-card share-card" data-open={open ? '' : undefined}>
  <button
    class="share-card-toggle"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="side-card-label">Share this dish</span>
    <span class="makeahead-chevron" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="share-actions">
      {#if canShare}
        <button class="add-to-plan" onclick={share}>Share…</button>
      {/if}
      <button class="add-to-plan" onclick={copyLink}>Copy link</button>
    </div>
    {#if copied}<p class="source-line" role="status">{copied}</p>{/if}

    <ShareTargets mode="post" {text} {body} {url} {title} {image} />
  {/if}
</div>

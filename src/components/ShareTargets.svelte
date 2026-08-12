<script lang="ts">
  /**
   * Where a shopping list can be sent. §8.4
   *
   * Every one of these is an ordinary link the reader clicks: the page hands the
   * text to a service the reader chose, and nothing is sent on their behalf.
   *
   * Two shapes of destination, and the difference decides what each link
   * carries. WhatsApp, X, Gmail and mail take a *message*, so they get the whole
   * list with the share URL already inside it. Telegram and Facebook take a
   * *link* as their own parameter, so those get the URL separately and a list
   * built without it — otherwise the address arrives twice in one message.
   *
   * Instagram is deliberately absent. It publishes no way to hand text or a link
   * to it from a web page, so a button would either dead-end on instagram.com or
   * do nothing at all. On a phone the Share button below reaches it, because the
   * operating system's own share sheet lists it; that is the only route there is.
   */
  interface Props {
    /** The full list, with the share URL in it. */
    text: string;
    /** The same list without the trailing URL, for destinations that take one. */
    body: string;
    url: string;
  }

  const { text, body, url }: Props = $props();

  const e = encodeURIComponent;

  const targets = $derived([
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      href: `https://wa.me/?text=${e(text)}`,
      path: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z',
    },
    {
      id: 'telegram',
      label: 'Telegram',
      href: `https://t.me/share/url?url=${e(url)}&text=${e(body)}`,
      path: 'M2 21l21-9L2 3v7l15 2-15 2z',
    },
    {
      id: 'x',
      label: 'X',
      href: `https://x.com/intent/post?text=${e(text)}`,
      path: 'M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.25 6.93zM17.61 20.64h2.04L6.49 3.24H4.3z',
    },
    {
      id: 'facebook',
      label: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`,
      path: 'M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.48 0-1.95.93-1.95 1.87v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z',
    },
    {
      id: 'gmail',
      label: 'Gmail',
      href: `https://mail.google.com/mail/?view=cm&fs=1&su=${e('Shopping list — Xefy')}&body=${e(text)}`,
      path: 'M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z',
    },
    {
      id: 'email',
      label: 'Email',
      href: `mailto:?subject=${e('Shopping list — Xefy')}&body=${e(text)}`,
      path: 'M2 4h20a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm.9 2.4L12 13.3l9.1-6.9H2.9zM21 18V8.6l-8.4 6.4a1 1 0 0 1-1.2 0L3 8.6V18h18z',
    },
  ]);
</script>

<ul class="share-targets">
  {#each targets as t (t.id)}
    <li>
      <a
        class="share-target"
        href={t.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Send this list by ${t.label}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={t.path} />
        </svg>
        <span>{t.label}</span>
      </a>
    </li>
  {/each}
</ul>

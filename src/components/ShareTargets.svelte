<script lang="ts">
  /**
   * Where something can be sent, in two modes.
   *
   * **message** — a shopping list or a week's plan. These go to one person, not
   * to an audience: nobody posts their shopping list. Every destination here
   * opens a conversation with the text already written.
   *
   * **post** — a dish. This is the one thing on the site somebody might want to
   * put in front of an audience, so it gets the public intents instead.
   *
   * Two shapes of destination decide what each link carries. Some take a
   * *message*, so they get the whole text with the URL already inside it. Some
   * take a *link* in a parameter of their own, so they get the URL separately
   * and a text built without it — or the address arrives twice in one message.
   *
   * **What is missing, and why.** Instagram publishes no way to hand text or a
   * link to it from a web page, in Direct or anywhere else; X's DM composer has
   * no documented intent that prefills a message without already knowing the
   * recipient's numeric id. Buttons for those would open an app at its home
   * screen with nothing carried across, which is worse than not offering them.
   * Both are reachable through the device's own share sheet, which is what the
   * Share button beside this list opens — and on a phone that sheet is how most
   * people send anything anyway.
   */
  interface Props {
    mode: 'message' | 'post';
    /** The full text, with the URL already in it. */
    text: string;
    /** The same text without the URL, for destinations that take one separately. */
    body?: string;
    url: string;
    /** Post mode: the headline, and an image for the one network that wants one. */
    title?: string;
    image?: string;
  }

  const { mode, text, body = text, url, title = '', image = '' }: Props = $props();

  const e = encodeURIComponent;

  const ICONS = {
    whatsapp:
      'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z',
    telegram: 'M2 21l21-9L2 3v7l15 2-15 2z',
    sms: 'M12 2C6.48 2 2 6.03 2 11c0 2.78 1.4 5.26 3.6 6.9L5 22l4.5-2.2c.8.13 1.64.2 2.5.2 5.52 0 10-4.03 10-9s-4.48-9-10-9zm-4 10a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z',
    gmail:
      'M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z',
    email:
      'M2 4h20a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm.9 2.4L12 13.3l9.1-6.9H2.9zM21 18V8.6l-8.4 6.4a1 1 0 0 1-1.2 0L3 8.6V18h18z',
    x: 'M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.25 6.93zM17.61 20.64h2.04L6.49 3.24H4.3z',
    facebook:
      'M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.48 0-1.95.93-1.95 1.87v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z',
    pinterest:
      'M12 0C5.37 0 0 5.37 0 12c0 5.08 3.16 9.42 7.62 11.17-.1-.95-.2-2.4.04-3.44.22-.93 1.4-5.95 1.4-5.95s-.36-.72-.36-1.78c0-1.67.97-2.92 2.17-2.92 1.02 0 1.52.77 1.52 1.69 0 1.03-.66 2.57-1 4-.28 1.19.6 2.16 1.77 2.16 2.13 0 3.76-2.24 3.76-5.48 0-2.86-2.06-4.87-5-4.87-3.4 0-5.4 2.55-5.4 5.19 0 1.03.4 2.13.89 2.73.1.12.11.22.08.34l-.33 1.36c-.05.22-.17.27-.4.16-1.5-.7-2.44-2.89-2.44-4.65 0-3.79 2.75-7.27 7.93-7.27 4.17 0 7.4 2.97 7.4 6.93 0 4.14-2.6 7.47-6.22 7.47-1.21 0-2.35-.63-2.74-1.38l-.75 2.84c-.27 1.04-1 2.35-1.49 3.15C9.57 23.82 10.77 24 12 24c6.63 0 12-5.37 12-12S18.63 0 12 0z',
    reddit:
      'M24 11.78a3.4 3.4 0 0 0-3.4-3.4 3.36 3.36 0 0 0-2.3.92 16.6 16.6 0 0 0-8.9-2.83l1.5-7.06 4.9 1.04a2.42 2.42 0 1 0 .27-1.36l-5.5-1.17a.7.7 0 0 0-.83.53L8.05 6.47a16.6 16.6 0 0 0-8.98 2.83A3.4 3.4 0 1 0 2.9 15.4a6.4 6.4 0 0 0-.08 1.02c0 4.13 4.9 7.48 10.93 7.48s10.93-3.35 10.93-7.48c0-.34-.03-.68-.08-1.01a3.4 3.4 0 0 0 1.4-3.63zM6.9 14.2a2.42 2.42 0 1 1 4.84 0 2.42 2.42 0 0 1-4.84 0zm10.1 5.4c-1.7 1.7-5.3 1.8-6.35 1.8s-4.65-.1-6.35-1.8a.7.7 0 0 1 .98-.98c1.07 1.07 3.36 1.45 5.37 1.45s4.3-.38 5.37-1.45a.7.7 0 1 1 .98.98zm-.28-2.98a2.42 2.42 0 1 1 0-4.84 2.42 2.42 0 0 1 0 4.84z',
  };

  /** Sending it to someone. */
  const MESSAGE = $derived([
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${e(text)}` },
    {
      id: 'telegram',
      label: 'Telegram',
      href: `https://t.me/share/url?url=${e(url)}&text=${e(body)}`,
    },
    { id: 'sms', label: 'Text message', href: `sms:?&body=${e(text)}` },
    {
      id: 'gmail',
      label: 'Gmail',
      href: `https://mail.google.com/mail/?view=cm&fs=1&su=${e(title || 'From Xefy')}&body=${e(text)}`,
    },
    { id: 'email', label: 'Email', href: `mailto:?subject=${e(title || 'From Xefy')}&body=${e(text)}` },
  ]);

  /** Putting it in front of an audience. */
  const POST = $derived([
    { id: 'x', label: 'X', href: `https://x.com/intent/post?text=${e(body)}&url=${e(url)}` },
    {
      id: 'facebook',
      label: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`,
    },
    {
      id: 'pinterest',
      label: 'Pinterest',
      href:
        `https://www.pinterest.com/pin/create/button/?url=${e(url)}` +
        `&description=${e(body)}${image ? `&media=${e(image)}` : ''}`,
    },
    {
      id: 'reddit',
      label: 'Reddit',
      href: `https://www.reddit.com/submit?url=${e(url)}&title=${e(title || body)}`,
    },
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${e(text)}` },
    {
      id: 'telegram',
      label: 'Telegram',
      href: `https://t.me/share/url?url=${e(url)}&text=${e(body)}`,
    },
  ]);

  const targets = $derived(mode === 'post' ? POST : MESSAGE);
  const verb = $derived(mode === 'post' ? 'Post this to' : 'Send this by');
</script>

<ul class="share-targets">
  {#each targets as t (t.id)}
    <li>
      <a
        class="share-target"
        href={t.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${verb} ${t.label}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={ICONS[t.id as keyof typeof ICONS]} />
        </svg>
        <span>{t.label}</span>
      </a>
    </li>
  {/each}
</ul>

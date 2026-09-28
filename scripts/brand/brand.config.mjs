/**
 * Xefy's brand assets: what `build.mjs` draws. Everything site-specific lives
 * here; the layout it is poured into is `build.mjs`.
 *
 * Colours are the light theme's tokens from `src/styles/global.css`, copied as
 * hex because the card is rendered outside the browser. Re-run `npm run brand`
 * after changing any of them.
 */
const fontsource = (pkg, file) => `node_modules/@fontsource/${pkg}/files/${file}`;

export default {
  name: 'Xefy',
  url: 'kiarashfa.github.io/Xefy',
  tagline: 'A recipe encyclopedia where every number on the page is computed, never typed.',

  wordmark: [{ text: 'Xefy', weight: 500 }],

  cardTheme: 'light',
  colors: {
    background: '#faf7f2',
    ink: '#241f1c',
    inkSoft: '#55504a',
    muted: '#736a60',
    line: '#e4dcd0',
    accent: '#9a3324',
  },

  fonts: {
    display: {
      family: 'Fraunces',
      weight: 500,
      tracking: -2,
      files: [
        { path: fontsource('fraunces', 'fraunces-latin-500-normal.woff'), weight: 500 },
        { path: fontsource('fraunces', 'fraunces-latin-600-normal.woff'), weight: 600 },
      ],
    },
    body: {
      family: 'Inter',
      files: [
        { path: fontsource('inter', 'inter-latin-400-normal.woff'), weight: 400 },
        { path: fontsource('inter', 'inter-latin-600-normal.woff'), weight: 600 },
      ],
    },
  },

  /**
   * The favicon carries both palettes as custom properties switched by a media
   * query, which a rasteriser does not evaluate. Resolve them for the theme
   * being drawn.
   */
  mark(svg, theme) {
    const [chip, mark] = theme === 'dark' ? ['#e2795f', '#1c1a17'] : ['#8f2f21', '#faf7f2'];
    return svg
      .replace(/<style>[\s\S]*?<\/style>/, '')
      .replaceAll('var(--chip)', chip)
      .replaceAll('var(--mark)', mark);
  },
};

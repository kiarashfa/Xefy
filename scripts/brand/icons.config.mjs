/**
 * Xefy's icon settings: what `icons.mjs` draws. Everything site-specific lives
 * here; the layout it is poured into is `icons.mjs`.
 *
 * Colours are the light theme's tokens from `src/styles/global.css`, copied as
 * hex because the icons are rendered outside the browser. Re-run
 * `npm run brand:icons` after changing any of them.
 */
const fontsource = (pkg, file) => `node_modules/@fontsource/${pkg}/files/${file}`;

export default {
  name: 'Xefy',

  iconTheme: 'light',
  colors: {
    background: '#faf7f2',
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

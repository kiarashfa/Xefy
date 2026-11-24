import type { BrandConfig } from './brand.ts';

/**
 * Social card of Xefy: the one image used for link previews and for the GitHub social preview.
 * Edit the values below and run `npm run brand`; the layout itself is in brand.ts.
 * Paths are relative to the folder that holds `public/`.
 */
export default {
  name: 'Xefy',
  // The wordmark as HTML. The families are the ones listed in `fonts`; an accent letter is a coloured span.
  wordmark: `<span style="font-family:Fraunces;font-weight:500;letter-spacing:-.02em"><span style="color:#e2795f">X</span>efy</span>`,
  wordmarkSize: 150,
  // One short creative line, specific to this project.
  line: 'Recipes that do their own maths.',
  background: '#16110f',
  // Accent: rules, diamonds, first glow and most lights. Secondary: second glow and some lights.
  primary: '#e2795f',
  secondary: '#a02f3a',
  // The icon tile shown on the card.
  icon: 'public/icon-512.png',
  bodyFont: 'Inter',
  fonts: [
    { family: 'Fraunces', file: 'scripts/brand/fonts/fraunces-500-normal.woff', weight: 500 },
    { family: 'Inter', file: 'scripts/brand/fonts/inter-400-normal.woff', weight: 400 },
  ],
  output: 'public/og-image.jpg',
} satisfies BrandConfig;

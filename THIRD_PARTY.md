# Third-party material

Xefy includes or relies on the third-party material listed here. Each item stays under its own license, and the KFA Source-Available License does not apply to it.

## Software

Software that is delivered to visitors, either as script or as the generated stylesheet.

| Name | Used for | License |
| --- | --- | --- |
| [Astro](https://astro.build) | static site framework and the client runtime that loads interactive components | MIT |
| [Svelte](https://svelte.dev) | interactive components (serving scaler, catalog, plan, shopping list, reverse search) | MIT |
| [@astrojs/svelte](https://docs.astro.build/en/guides/integrations-guide/svelte/) | Svelte integration and client-side loading of those components | MIT |
| [Nanostores](https://github.com/nanostores/nanostores) | small shared state in the browser (units, plan, display settings) | MIT |
| [Pagefind](https://github.com/Pagefind/pagefind) | site search (the index is built at publish time and the search script runs in the browser) | MIT |
| [Tailwind CSS](https://tailwindcss.com) | generates the site stylesheet, whose notice is kept in the built CSS | MIT |

## Fonts

| Font | License | Source |
| --- | --- | --- |
| Fraunces (variable; normal 300 to 600, italic 400 to 500; latin and latin-ext subsets) | SIL OFL 1.1 | Google Fonts, fetched once by `scripts/data/fonts.ts` and self-hosted in `src/assets/fonts/`. Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) |
| Inter (variable, 400 to 600; latin and latin-ext subsets) | SIL OFL 1.1 | Google Fonts, fetched once by `scripts/data/fonts.ts` and self-hosted in `src/assets/fonts/`. Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) |

The Fontsource packages `@fontsource/fraunces` and `@fontsource/inter` are used to draw the social preview card (`public/og-image.jpg`) at build time. Their license text is kept in `scripts/brand/fonts/FONT-LICENSES.txt`.

## Data and services

| Name | Used for | Terms |
| --- | --- | --- |
| [USDA FoodData Central](https://fdc.nal.usda.gov) | nutrition per 100 g for ingredients: 410 records kept in `src/data/nutrition-sources/` (349 SR Legacy and 61 Foundation) | public domain (work of the US federal government) |
| US FDA Daily Values (21 CFR 101.9) | the reference amounts for the percent Daily Value column | public domain (work of the US federal government) |
| Other composition references | nutrition for four ingredients that USDA does not cover: CFNI Food Composition Tables for the English-Speaking Caribbean (1998), NOAA CAMEO Chemicals, Japanese Standard Tables of Food Composition in Japan (2015), and published Philippine shrimp-paste composition studies | cited on each ingredient record |
| [Wikimedia Commons](https://commons.wikimedia.org) | photographs, credited per file | the license recorded for each file (see Media) |
| [Open Food Facts](https://world.openfoodfacts.org) | 4 product photographs | CC BY-SA 3.0, as recorded on each image |
| [Rawpixel](https://www.rawpixel.com) | 6 photographs | CC0 1.0, as recorded on each image |
| [WordPress Photo Directory](https://wordpress.org/photos/) | 1 photograph | CC0 1.0, as recorded on the image |
| [Wikipedia](https://en.wikipedia.org) and other web sources | cited on each recipe, ingredient and technique page under its sources (207 distinct Wikipedia pages; 701 source links listed in all) | cited, not reproduced |
| Google Analytics (loaded from `www.googletagmanager.com`) | page-view statistics in the published site only, and only after the visitor accepts analytics in the cookie bar; the page address is sent without query string or fragment | Google's terms apply |

The site makes no other runtime call to a third party. Everything else it fetches comes from its own origin.

## Media

Every photograph is credited in `src/data/image-credits.json` (author, license, source page, the change made, and the date retrieved) and listed with its license and source link on the site's `/attributions/` page ("Image credits"), which each photograph's credit popover links to. There are 654 photographs (308 recipes, 344 ingredients and 2 components), each in three sizes. None is generated.

Every photograph has been cropped square, white-balanced and colour-graded so the set reads as one publication. That makes each an adaptation, offered under the same license as the original. 380 of the 654 are ShareAlike, and their adapted versions are offered under those same terms.

| License | Count |
| --- | --- |
| CC BY-SA (4.0: 235, 3.0: 83, 2.0: 56, 2.5: 6) | 380 |
| CC BY (2.0: 94, 4.0: 36, 3.0: 20, 2.5: 2) | 152 |
| CC0 | 91 |
| Public domain | 25 |
| GFDL | 5 |
| Recorded only as "Attribution" | 1 |

By source: Wikimedia Commons 643, Rawpixel 6, Open Food Facts 4, WordPress Photo Directory 1.

The PayPal and Buy Me a Coffee marks (`src/assets/paypal.svg` and `src/assets/buy-me-a-coffee.svg`) appear on the About page to identify the donation links. They are the trademarks of their owners and are not covered by the KFA Source-Available License.

## License texts

<details>
<summary>MIT License</summary>

```
Astro, @astrojs/svelte: Copyright (c) 2021 Fred K. Schott
  (Astro also carries parts that originate from the SvelteKit and Vite
  projects, under the same MIT terms: Copyright (c) 2020 SvelteKit contributors;
  Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors)
Svelte: Copyright (c) 2016-2025 Svelte Contributors
Nanostores: Copyright 2020 Andrey Sitnik <andrey@sitnik.es>
Pagefind: Copyright (c) Pagefind
Tailwind CSS: Copyright (c) Tailwind Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>SIL Open Font License 1.1</summary>

```
Fraunces: Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)
Inter: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

</details>

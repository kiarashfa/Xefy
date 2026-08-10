/**
 * Whether a candidate image can actually be used, and on what terms.
 *
 * This is a correctness question rather than a preference. The pipeline crops
 * and colour-grades every image, which produces an adaptation — so a
 * NoDerivatives licence rules a photograph out entirely, however good it is,
 * and ShareAlike brings obligations that have to be carried through to the
 * attributions page rather than noticed later.
 */

export type Verdict = 'preferred' | 'acceptable' | 'caution' | 'rejected';

export interface LicenseAssessment {
  verdict: Verdict;
  /** Why, in one sentence, for the curation listing. */
  reason: string;
  shareAlike: boolean;
  attributionRequired: boolean;
}

const has = (text: string, ...needles: string[]) =>
  needles.some((n) => text.includes(n));

export function assessLicense(shortName: string, usageTerms = ''): LicenseAssessment {
  const text = `${shortName} ${usageTerms}`.toLowerCase();

  // Derivatives are forbidden, and this pipeline only makes derivatives.
  if (has(text, 'noderiv', 'no derivative', '-nd', ' nd ')) {
    return {
      verdict: 'rejected',
      reason: 'NoDerivatives — the crop and colour grade would not be permitted.',
      shareAlike: false,
      attributionRequired: true,
    };
  }

  if (has(text, 'fair use', 'non-free', 'all rights reserved', 'copyrighted free use')) {
    return {
      verdict: 'rejected',
      reason: 'Not a free licence.',
      shareAlike: false,
      attributionRequired: true,
    };
  }

  if (has(text, 'public domain', 'cc0', 'pd-')) {
    return {
      verdict: 'preferred',
      reason: 'Public domain — no obligations.',
      shareAlike: false,
      attributionRequired: false,
    };
  }

  const shareAlike = has(text, 'share alike', 'sharealike', '-sa');
  const nonCommercial = has(text, 'noncommercial', 'non-commercial', '-nc');

  if (nonCommercial) {
    return {
      verdict: 'caution',
      reason:
        'NonCommercial. Xefy is non-profit and ad-free so this is usable, but it constrains the site in a way nothing else does — prefer another candidate.',
      shareAlike,
      attributionRequired: true,
    };
  }

  if (has(text, 'cc by') || has(text, 'attribution')) {
    return shareAlike
      ? {
          verdict: 'acceptable',
          reason:
            'CC BY-SA — usable, but the graded image must be offered under the same licence and the modification stated.',
          shareAlike: true,
          attributionRequired: true,
        }
      : {
          verdict: 'preferred',
          reason: 'CC BY — attribution only.',
          shareAlike: false,
          attributionRequired: true,
        };
  }

  return {
    verdict: 'caution',
    reason: `Licence not recognised ("${shortName}") — check it by hand before using.`,
    shareAlike,
    attributionRequired: true,
  };
}

/** Sort order for the curation listing: least encumbered first. */
export const VERDICT_RANK: Record<Verdict, number> = {
  preferred: 0,
  acceptable: 1,
  caution: 2,
  rejected: 3,
};

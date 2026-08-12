import sharp from 'sharp';

/**
 * The image treatment.
 *
 * This is part of the visual identity, not a technical afterthought. Wikimedia
 * photographs come from hundreds of photographers under hundreds of lighting
 * conditions, and dropped onto a page side by side they read as a scrapbook.
 * Putting every image through the same process is what makes them read as one
 * publication instead.
 *
 * The order matters, and it is the part worth understanding: **normalise
 * first, then grade.** A fixed colour shift applied to every image cannot make
 * a set cohere, because the images do not start in the same place — one is
 * shot under tungsten, the next in daylight, the next under a kitchen
 * fluorescent. Warming all three by the same amount keeps all three different.
 * So each image is first pulled toward a neutral baseline, and only then does
 * the shared grade go on top. The grade is what makes them Xefy's; the
 * normalisation is what makes the grade land the same way on each.
 */

/** Every output is square. The hero, the card and the thumbnail share one crop. */
export const OUTPUT_SIZES = {
  hero: 1200,
  card: 800,
  thumb: 200,
} as const;

export type OutputSize = keyof typeof OUTPUT_SIZES;

export const TREATMENT = {
  /**
   * How far toward neutral an image is pulled before grading, and the ceiling
   * on any single channel's correction.
   */
  whiteBalanceStrength: 0.7,
  whiteBalanceClamp: 0.08,

  /**
   * Where a colour cast stops looking like lighting and starts looking like
   * the subject. Below the first figure the channel spread is small enough to
   * be a white-balance error and is corrected in full; above the second it is
   * almost certainly the photograph's actual content — a tomato plant, a bowl
   * of basil — and is left nearly alone.
   */
  castDominanceLow: 0.06,
  castDominanceHigh: 0.2,

  /** Gentle levels stretch, ignoring the extreme tails so speculars survive. */
  normaliseLower: 1,
  normaliseUpper: 99,

  /** Pulled down, not up: restraint is the direction, warmth comes after. */
  saturation: 0.94,
  brightness: 1.01,

  /**
   * The house warmth, applied once every image is on the same footing. Red
   * gains, blue gives way, and the small offsets lift shadows off pure black so
   * images sit on the warm page ground rather than punching holes in it.
   */
  channelGain: [1.045, 1.0, 0.94] as [number, number, number],
  channelOffset: [4, 2, -1] as [number, number, number],

  gamma: 1.03,
  webpQuality: 82,
} as const;

/**
 * The sentence that goes in each image's `modified` field.
 *
 * ShareAlike requires modifications to be *indicated*, not itemised, and the
 * itemised version — white balance, grading, resampling, re-encoding — told a
 * reader nothing they could act on while taking three lines of an attribution
 * popover to do it. What the treatment actually consists of belongs in this
 * file, where someone can read the code.
 */
export const MODIFICATION_NOTE = 'Cropped and colour-adjusted for this site.';

const clamp = (value: number, spread: number) => Math.min(1 + spread, Math.max(1 - spread, value));

/**
 * Per-channel gains that pull an image's colour cast toward neutral.
 *
 * Grey-world: over a whole photograph the channel averages ought to be roughly
 * equal, so the ratio between each channel's mean and the overall mean
 * estimates the cast.
 *
 * The assumption fails, badly, on photographs where one colour *is* the
 * subject. Applied at full strength to a tomato plant it reads all that green
 * as an error, pulls green down and the others up, and turns the sky lilac. So
 * the correction is scaled by how dominant the cast is: a small imbalance is
 * treated as a lighting error and fixed, a large one is treated as the picture
 * and left alone.
 */
async function whiteBalanceGains(input: Buffer): Promise<[number, number, number]> {
  const { channels } = await sharp(input).stats();
  const [r, g, b] = channels;
  if (!r || !g || !b) return [1, 1, 1];

  const means = [r.mean, g.mean, b.mean];
  const overall = (means[0]! + means[1]! + means[2]!) / 3;
  if (overall <= 0) return [1, 1, 1];

  const dominance = Math.max(...means.map((m) => Math.abs(m - overall) / overall));
  const { castDominanceLow: low, castDominanceHigh: high } = TREATMENT;
  const confidence =
    dominance <= low ? 1 : dominance >= high ? 0 : 1 - (dominance - low) / (high - low);
  const strength = TREATMENT.whiteBalanceStrength * confidence;

  return means.map((mean) => {
    const full = overall / Math.max(mean, 1);
    const damped = 1 + (full - 1) * strength;
    return clamp(damped, TREATMENT.whiteBalanceClamp);
  }) as [number, number, number];
}

function cropped(input: Buffer, edge: number) {
  return (
    sharp(input)
      .rotate() // honour EXIF orientation before cropping
      // Attention rather than centre: food is frequently composed off-centre,
      // and a centre crop cuts the dish in half often enough to matter.
      .resize(edge, edge, { fit: 'cover', position: sharp.strategy.attention })
  );
}

/** Crops square, normalises, grades, and encodes. */
export async function treat(input: Buffer, size: OutputSize): Promise<Buffer> {
  const edge = OUTPUT_SIZES[size];
  const gains = await whiteBalanceGains(input);

  const balanced = await cropped(input, edge)
    .linear(gains, [0, 0, 0])
    .normalise({ lower: TREATMENT.normaliseLower, upper: TREATMENT.normaliseUpper })
    .toBuffer();

  return sharp(balanced)
    .modulate({ saturation: TREATMENT.saturation, brightness: TREATMENT.brightness })
    .linear(TREATMENT.channelGain, TREATMENT.channelOffset)
    .gamma(TREATMENT.gamma)
    // Resampling always softens; this puts back what it took, no more.
    .sharpen({ sigma: 0.6 })
    .webp({ quality: TREATMENT.webpQuality, effort: 5 })
    .toBuffer();
}

/** The same crop and encode with no treatment, for before-and-after comparison. */
export async function untreated(input: Buffer, size: OutputSize): Promise<Buffer> {
  return cropped(input, OUTPUT_SIZES[size])
    .webp({ quality: TREATMENT.webpQuality, effort: 5 })
    .toBuffer();
}

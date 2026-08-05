/**
 * Leaf module: reading games off a photograph.
 *
 * **Photos are transient.** Nobody wants a camera roll full of pictures only one
 * app needed, and the same logic applies server-side: a photo is captured into
 * memory, sent, read, and dropped. It is never written to the device's photo
 * library, never stored in D1, and never put in R2 unless the owner explicitly
 * asks for a cover image on a copy. This constrains capture to a live
 * `getUserMedia` frame grab — the one path on iOS that provably touches nothing.
 *
 * Two different jobs, deliberately kept apart:
 *
 *   identify  one box, read carefully -> a BarcodeCandidate, same shape every
 *             other rung of the ladder answers in
 *   shelf     many spines, read broadly -> plain titles to be matched afterwards
 *
 * Shelf reading returns *titles*, not candidates, because resolving twelve
 * spines through web search would take minutes and cost more than the whole
 * feature is worth. Matching happens afterwards, against the local catalog and
 * the free lookup rungs.
 *
 * Imports nothing. No I/O.
 */

/** One title read off a spine or cover, before anything tries to resolve it. */
export interface ShelfTitle {
  /** Exactly the text as printed, no expansion or correction. */
  text: string;
  confidence: 'high' | 'medium' | 'low';
  /** Where on the shelf, left to right, so the user can find it again. */
  position: number;
  /** Why it is uncertain: glare, partly hidden, stylised type. */
  note: string | null;
}

/**
 * A shelf title once we have tried to match it against what we know.
 *
 * `alreadyOwned` is the point of the whole screen — re-adding games you already
 * have is the obvious failure mode of bulk intake, so it is resolved before the
 * user is asked to tick anything.
 */
export interface ShelfMatch {
  title: ShelfTitle;
  /** Set when this title matches something already in the collection. */
  existingItemId: number | null;
  existingName: string | null;
  /** Best guess from the free lookup rungs, when it found one. */
  bggId: number | null;
  resolvedName: string | null;
  thumbnailUrl: string | null;
}

/**
 * Long edge, in pixels, to downscale a photo to before upload.
 *
 * Claude charges images in 28x28 patches: ceil(w/28) * ceil(h/28) visual tokens.
 * Opus 5 is in the high-resolution tier — it accepts up to 2576px on the long
 * edge and caps at 4784 visual tokens, downscaling anything larger server-side.
 *
 * 1500px is the sweet spot for a box: a title occupies a large fraction of the
 * frame and is already 100+px tall at this size, so the extra pixels up to 2576
 * roughly double the cost for no gain. A 48MP iPhone photo is pure waste — it
 * gets downscaled anyway, after you have paid to upload it.
 */
export const PHOTO_LONG_EDGE = 1500;

/**
 * Fold a title down to something comparable.
 *
 * Spines print titles in ways the catalog never will — all caps, ampersands,
 * accented type, a leading article. None of that changes which game it is.
 */
export function normaliseTitle(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // Café -> Cafe
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Match a title read off a shelf against items already in the collection.
 *
 * Exact-after-normalising first, then containment — a spine reading "CATAN"
 * finds "Catan", and one reading "Catan Seafarers" finds "Catan: Seafarers".
 * Containment is checked both ways because a spine may print more or less than
 * the catalog does. The longest match wins, so "Catan: Seafarers" beats plain
 * "Catan" when the spine actually said Seafarers.
 *
 * Deliberately conservative: no fuzzy edit-distance matching. A wrong match
 * silently merges two different games, which is far worse than asking about one
 * the user already owns.
 */
export function matchExistingTitle<T extends { id: number; name: string }>(
  title: string,
  existing: readonly T[],
): T | null {
  const target = normaliseTitle(title);
  if (target.length < 2) return null;

  const indexed = existing.map((item) => ({ item, key: normaliseTitle(item.name) }));

  const exact = indexed.find((e) => e.key === target);
  if (exact) return exact.item;

  return (
    indexed
      .filter((e) => e.key.length > 2 && (e.key.includes(target) || target.includes(e.key)))
      .sort((a, b) => b.key.length - a.key.length)[0]?.item ?? null
  );
}

/**
 * Shelves earn the extra pixels: a dozen spines share the frame, so each title
 * is a fraction of the height a single box cover gets. 2400 stays under the
 * 2576px high-resolution ceiling, so nothing is re-scaled server-side.
 */
export const SHELF_LONG_EDGE = 2400;

/**
 * JPEG quality for the downscaled upload.
 *
 * 0.85, not lower: the phone's photo is *already* lossy, so this is a second
 * compression pass and the artifacts stack exactly on the letterforms we need to
 * read. Below ~0.7 small type visibly mushes. One decode, one resize, one encode.
 */
export const PHOTO_QUALITY = 0.85;

/**
 * iOS Safari refuses to render a canvas whose area exceeds this, and does it
 * *silently* — you get a blank image rather than an error. A 48MP iPhone photo
 * (8064x6048) is roughly three times over. This is why downscaling must happen
 * during decode via `createImageBitmap({resizeWidth})` rather than by drawing
 * the full-size image to a canvas first.
 */
export const IOS_MAX_CANVAS_AREA = 16_777_216;

/**
 * How different two photos may be and still count as the same box.
 *
 * These are 64-bit difference hashes, so the distance is "how many of the 64
 * brightness comparisons flipped". Two handheld shots of the same cover
 * typically land within 6-8; genuinely different games are usually well past 20.
 * Set conservatively — returning a *wrong* cached reading is far worse than
 * paying for a second look.
 */
export const PHOTO_HASH_MAX_DISTANCE = 8;

/** Bits that differ between two hex-encoded 64-bit hashes. 65 means "not comparable". */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length || a.length !== 16) return 65;
  let total = 0;
  for (let i = 0; i < 16; i++) {
    // Nibble at a time: 64-bit values do not fit in a JS number safely.
    let diff = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (diff) {
      total += diff & 1;
      diff >>= 1;
    }
  }
  return total;
}

/** Request bodies cap out well below this; a guard beats a confusing 413. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

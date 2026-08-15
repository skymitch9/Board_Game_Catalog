/**
 * Whose picture a row shows when it has none of its own.
 *
 * A leaf module: it imports a type from `details.ts` and nothing else, so the
 * database layer and the web app can both build on it. See `constants.ts` for
 * why the import order in this package matters.
 *
 * ## Why this exists
 *
 * *"for 161 just use the base game photo, maybe we should use that as a default
 * fallback so no matter what everything has an image"* — the owner, about Deep
 * Rock Galactic: Barrel Flick Game.
 *
 * Measured against production's 760 rows: **437 have a cover of their own, 322
 * have an ancestor that does, and exactly one has neither** (Excursion Tiles 1,
 * a standalone accessory with no parent to borrow from). So the fallback is not
 * a rare rescue — it is what three hundred rows in the collection will show.
 *
 * ## The two rules, and why each is the way it is
 *
 * 1. **Nearest ancestor, not the root.** A Dice Throne hero's playmat takes the
 *    hero's art before the box's, because the hero is the more specific answer
 *    to "what is this a picture of". Walking to the root would put the same
 *    Marvel Dice Throne box on all fifty-five of them.
 * 2. **Resolved at read time, never written.** The same reasoning as
 *    `INHERITED_FIELDS` in `details.ts`, plus one more that is specific to
 *    covers: a stored URL would be probed by the cover-health cron twice an hour
 *    for every row that copied it, so 322 rows would turn one dead link into
 *    323 alarms. Nothing here writes; `thumbnail_url` stays NULL until the row
 *    genuinely has art of its own, and the day it does the borrowed picture
 *    simply stops being used.
 *
 * ## What it does *not* do
 *
 * It does not distinguish "nobody has looked for a cover" from "there is no
 * cover to find". That distinction was considered and dropped: with 322 of the
 * 323 blanks now answered by an ancestor, it would be a column carrying one row.
 */

import type { InheritedDetail } from './details.js';

/** Enough of an ancestor to lend its picture. */
export interface CoverLender {
  id: number;
  name: string;
  thumbnailUrl: string | null;
}

/** True for null, undefined, and a string of nothing but spaces. */
function blank(url: string | null | undefined): boolean {
  return url == null || url.trim() === '';
}

/**
 * The picture this row borrows, or null when it needs none and when none exists.
 *
 * `ancestors` must be **nearest first** — the parent, then the grandparent. Both
 * callers produce that order already: the recursive CTE in
 * `resolveInheritedDetails` orders by depth, and the tree walker in `buildTrees`
 * pushes each node's parent on the front as it descends.
 *
 * Returns null for a row that has its own cover, so a caller can treat a
 * non-null answer as "this picture belongs to something else" without a second
 * test — which is exactly the condition the item page needs in order to say so.
 */
export function inheritCover(
  own: string | null,
  ancestors: readonly CoverLender[],
): InheritedDetail | null {
  if (!blank(own)) return null;
  const source = ancestors.find((a) => !blank(a.thumbnailUrl));
  if (!source) return null;
  return { value: source.thumbnailUrl as string, fromItemId: source.id, fromName: source.name };
}

// ---------------------------------------------------------------------------
// Rehosting: is this really an image, and where does a hosted copy live?
//
// Ported verbatim from `library_catalog/packages/core/src/covers.ts` (the
// same functions library used for its own third-party rehost, 2026-08-13),
// per `catalog-platform/docs/info/covers-consolidation-plan.md` §2.3. Games
// has no `work_key`, so `coverObjectKey`'s first argument is seeded with
// `${item.id}-${item.name}` (or an edition's name) by the caller — the
// function only uses it for a human-readable prefix in the bucket listing,
// never as an identity key. The hash is the identity.
// ---------------------------------------------------------------------------

export type CoverImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/avif';

const COVER_IMAGE_TYPE_LIST: readonly CoverImageType[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
];

/**
 * The size floor, shared by the migration script and the intake hook.
 *
 * Exists because a hotlinked host can answer HTTP 200 with a tiny placeholder
 * (Open Library's 43-byte 1x1 is the documented case in the sibling catalogs;
 * nothing in the 78-URL sample taken for this plan looked like one, but the
 * defence costs nothing to keep).
 */
export const MIN_COVER_BYTES = 1000;

/** The ceiling — rejects a raw photo upload, not a real cover. */
export const MAX_COVER_BYTES = 6 * 1024 * 1024;

function hexHead(bytes: Uint8Array, length: number): string {
  let out = '';
  for (let i = 0; i < length && i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to && i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

/**
 * What this file actually is, read from its own first bytes — never the
 * declared `Content-Type`, which is a claim and not evidence. Returns null
 * for anything not in the accepted set, including SVG (a document that can
 * carry script, not a cover type this app serves).
 */
export function sniffImageType(bytes: Uint8Array): CoverImageType | null {
  if (hexHead(bytes, 3) === 'ffd8ff') return 'image/jpeg';
  if (hexHead(bytes, 8) === '89504e470d0a1a0a') return 'image/png';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

/** The file extension an object of this type is stored under. */
export function extensionFor(type: CoverImageType): string {
  return type === 'image/jpeg' ? 'jpg' : type.slice('image/'.length);
}

export interface UploadCheck {
  ok: boolean;
  contentType: CoverImageType | null;
  bytes: number;
  reason?: string;
}

/** Decide whether these bytes may be stored as a cover — sniffed type, then the floor/ceiling. */
export function checkCoverUpload(bytes: Uint8Array, declaredType?: string | null): UploadCheck {
  const size = bytes.byteLength;

  if (size === 0) {
    return { ok: false, contentType: null, bytes: 0, reason: 'That file is empty.' };
  }
  if (size > MAX_COVER_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      contentType: null,
      bytes: size,
      reason: `${mb}MB is larger than the ${MAX_COVER_BYTES / (1024 * 1024)}MB limit.`,
    };
  }

  const contentType = sniffImageType(bytes);
  if (!contentType) {
    const said = declaredType && declaredType.trim() !== '' ? ` It claimed to be ${declaredType}.` : '';
    return {
      ok: false,
      contentType: null,
      bytes: size,
      reason: `That is not an image this app can serve — the file's own bytes are not ${COVER_IMAGE_TYPE_LIST.map((t) => t.slice(6).toUpperCase()).join(', ')}.${said}`,
    };
  }

  if (size < MIN_COVER_BYTES) {
    return {
      ok: false,
      contentType,
      bytes: size,
      reason: `${size} bytes is a placeholder, not a cover.`,
    };
  }

  return { ok: true, contentType, bytes: size };
}

/**
 * Where a rehosted or uploaded cover is stored — content-addressed, so a
 * replaced cover is a new URL and a cached copy can never go stale.
 */
export function coverObjectKey(workKey: string, digestHex: string, type: CoverImageType): string {
  const slug =
    workKey
      .replace(/\|/g, '-')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 80) || 'cover';
  return `covers/${slug}-${digestHex.slice(0, 16)}.${extensionFor(type)}`;
}

/**
 * A hook `updateItem`/`createItem` may call before writing `thumbnail_url`,
 * so a hand-typed or scan-matched hotlink can become a `gamecovers.
 * heygabi.ai` URL before the row is ever written — the "stops growing" half
 * of the consolidation plan. Returns the URL to actually store; must never
 * throw (a hosting hiccup must not block a save).
 */
export type CoverHoster = (url: string) => Promise<string>;

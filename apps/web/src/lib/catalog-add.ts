import {
  fillableFieldsFor,
  type BarcodeCandidate,
  type ComponentStatus,
  type CopyStatus,
  type CreateCopyInput,
  type Item,
  type ItemKind,
} from '@bgc/core';
import { api } from '../api';

/**
 * Turning something we found into a catalog row.
 *
 * Three screens create items out of things a lookup handed them — the scanner,
 * the completeness report's "I have it" / "+ Wishlist" pair, and the wishlist's
 * own scan-and-add. All three had the same short passage of code, and the part
 * that matters is not the `createItem` call but the **policy** wrapped round it:
 * `fillableFieldsFor` decides what a row of a given kind may hold at all, and a
 * caller that forgets it produces a dice tray for 2–6 players with a
 * description of a dice game. See `packages/core/src/details.ts` for why that
 * gate exists and what it refuses.
 *
 * So the policy lives here once, and the screens differ only in what they do
 * afterwards — navigate, link a barcode, tick a checkbox.
 */

/**
 * The fields a copy needs that nobody standing in a shop wants to be asked.
 *
 * `physical` is the default everywhere a copy is created from something seen or
 * scanned: a licence is the rarer case and is edited in on the item page. The
 * two booleans are facts about a box you are holding, and you are not holding
 * this one yet.
 */
export function copyDefaults(status: CopyStatus, quantity = 1): CreateCopyInput {
  return {
    quantity: Math.max(1, quantity),
    status,
    format: 'physical',
    isSleeved: false,
    isPunched: false,
  };
}

/**
 * Create a catalog row from a barcode or photo candidate.
 *
 * ⚠️ **A candidate describes *a game*, and the row being created may not be
 * one.** The lookup behind it was given a title read off a box, so adding
 * "Dice Throne Vanguard: Dice Tray" as an accessory would otherwise write a
 * player count, a playing time and a description of a dice game onto it.
 * `fillableFieldsFor` is the same policy the paid details lookup obeys.
 */
export async function createItemFromCandidate(
  candidate: BarcodeCandidate,
  opts: {
    kind?: ItemKind;
    parentItemId?: number | null;
    pendingParentName?: string | null;
  } = {},
): Promise<Item> {
  const kind = opts.kind ?? 'base';
  const allowed: readonly string[] = fillableFieldsFor(kind, null);
  const ifAllowed = <T,>(field: string, value: T): T | null =>
    allowed.includes(field) ? value : null;

  const { item } = await api.createItem({
    name: candidate.name,
    kind,
    parentItemId: kind === 'base' ? null : (opts.parentItemId ?? null),
    pendingParentName: opts.pendingParentName ?? null,
    bggId: candidate.bggId,
    yearPublished: candidate.yearPublished,
    publisher: candidate.publisher,
    thumbnailUrl: candidate.thumbnailUrl,
    minPlayers: ifAllowed('minPlayers', candidate.minPlayers),
    maxPlayers: ifAllowed('maxPlayers', candidate.maxPlayers),
    playtimeMin: ifAllowed('playtimeMin', candidate.playtimeMin),
    description: ifAllowed('description', candidate.description),
  });
  return item;
}

/**
 * Create a catalog row from something BoardGameGeek lists under a game.
 *
 * The publisher is passed to the policy as well as written by it, and that is
 * not belt and braces: BGG credits fan-made components to `(Public Domain)`,
 * a spelling `isTraditionalPublisher` recognises, and a row with that publisher
 * is one the catalog says may carry neither a publisher nor a year.
 */
export async function createItemFromComponent(
  component: ComponentStatus,
  gameId: number,
): Promise<Item> {
  const publisher = component.publishers?.[0]?.name ?? null;
  const allowed = new Set<string>(fillableFieldsFor(component.kind, null, publisher));

  const { item } = await api.createItem({
    name: component.name,
    kind: component.kind,
    parentItemId: gameId,
    bggId: component.bggId,
    yearPublished: allowed.has('yearPublished') ? component.yearPublished : null,
    publisher: allowed.has('publisher') ? publisher : null,
    thumbnailUrl: component.thumbnailUrl,
  });
  return item;
}

/** Create the row and say we hold — or want — one. The pair, in the usual order. */
export async function addComponent(
  component: ComponentStatus,
  gameId: number,
  status: CopyStatus,
): Promise<Item> {
  const item = await createItemFromComponent(component, gameId);
  await api.createCopy(item.id, copyDefaults(status));
  return item;
}

/**
 * Render smoke-test for the item page's crash-prone VIEW LOGIC.
 *
 * The contract test (`item-detail-contract.test.ts`) proves the response
 * carries the fields the page reads. This proves the pure logic the page runs
 * OVER those fields does not throw on the awkward-but-legal items the catalog
 * actually holds — the second half of "a build that would white-screen cannot
 * ship".
 *
 * `ItemPage.tsx` renders the completeness / "what's missing" panel by calling
 * `@bgc/core`'s `detailGaps(item)`, `fillableFieldsFor(...)` and
 * `impossibleFields(...)` on the live item, then `.map`s the labels. These run
 * on EVERY item render, so a throw in any of them blanks the page. The estate
 * catalog is full of the edge rows that find such throws: a folk game with no
 * publisher and no year (Go Fish), a rulebook (`gameSystem` set, no player
 * count), an accessory (a thing you own, not a game), an orphan expansion, and
 * a row whose `kind` is a string the enum never anticipated.
 *
 * The web tests live under `apps/web/test/` and are NOT run by the estate gate
 * (`npm test` globs `apps/worker/src/lib/*.test.ts`). This logic lives in
 * `@bgc/core`, so it can be exercised here, INSIDE the gate that guards deploy.
 *
 * ⚠️ Proven to go RED: make `detailGaps` throw (or return a non-array) and the
 * "never throws" / "always an array" assertions fail. That proof is in the
 * guards' commit / the task report.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detailGaps,
  fillableFieldsFor,
  impossibleFields,
  FILL_FIELDS,
  type DetailSubject,
} from '@bgc/core';

/** The awkward-but-real rows the item page must render without throwing. */
const SUBJECTS: Record<string, DetailSubject> = {
  'a fully-blank base game (nothing filled in yet)': {
    kind: 'base',
    parentItemId: null,
  },
  'a folk game — no publisher, no year (the Go Fish row)': {
    kind: 'base',
    parentItemId: null,
    publisher: 'Traditional',
    yearPublished: null,
    minPlayers: null,
    playtimeMin: null,
  },
  'a rulebook — a game system but no player count': {
    kind: 'base',
    parentItemId: null,
    gameSystem: 'D&D 5e (2014)',
    minPlayers: null,
    playtimeMin: null,
  },
  'an accessory — a thing you own, not a game you play': {
    kind: 'accessory',
    parentItemId: 42,
    description: null,
    minPlayers: null,
  },
  'an orphan expansion — no parent yet, so still asked for details': {
    kind: 'expansion',
    parentItemId: null,
    publisher: null,
    publisherUrl: null,
  },
  'a row whose kind is a string outside the enum (defensive)': {
    kind: 'something-new-the-owner-bought',
    parentItemId: null,
  },
  'a fully-populated base game (nothing left to ask for)': {
    kind: 'base',
    parentItemId: null,
    gameSystem: null,
    publisher: 'Stonemaier Games',
    publisherUrl: 'https://stonemaier.example',
    yearPublished: 2019,
    minPlayers: 1,
    playtimeMin: 90,
    description: 'A worker-placement game.',
  },
};

describe('item-view render smoke — the page logic never throws on a real item', () => {
  for (const [label, subject] of Object.entries(SUBJECTS)) {
    it(`detailGaps renders for: ${label}`, () => {
      let gaps: readonly string[];
      assert.doesNotThrow(() => {
        gaps = detailGaps(subject);
      }, `detailGaps threw on ${label} — the item page would white-screen`);
      // Must be an array (the page does `detailGaps(item).map(...)`), and every
      // entry must be a known fill field (a stray label would render as blank).
      gaps = detailGaps(subject);
      assert.ok(Array.isArray(gaps), 'detailGaps must return an array to be .map()-ed');
      for (const g of gaps) {
        assert.ok(
          (FILL_FIELDS as readonly string[]).includes(g),
          `detailGaps returned an unknown field "${g}"`,
        );
      }
    });

    it(`fillableFieldsFor / impossibleFields render for: ${label}`, () => {
      let fillable: readonly string[] = [];
      let impossible: readonly string[] = [];
      assert.doesNotThrow(() => {
        impossible = impossibleFields(subject.kind, subject.gameSystem, subject.publisher);
        fillable = fillableFieldsFor(subject.kind, subject.gameSystem, subject.publisher);
      }, `fill/impossible logic threw on ${label} — the page would white-screen`);
      assert.ok(Array.isArray(fillable) && Array.isArray(impossible));
      // fillable and impossible must PARTITION FILL_FIELDS: a field is either
      // askable or refused, never both and never neither. A page that showed a
      // field as both fillable and impossible is a rendered contradiction.
      for (const f of fillable) {
        assert.ok(
          !impossible.includes(f),
          `${label}: "${f}" is reported both fillable AND impossible`,
        );
      }
      assert.equal(
        fillable.length + impossible.length,
        FILL_FIELDS.length,
        `${label}: fillable + impossible must cover every FILL_FIELD exactly once`,
      );
    });
  }
});

import { useState } from 'react';
import { ITEM_KINDS, type Item, type ItemKind, type MeResponse } from '@bgc/core';
import { api } from '../api';
import { copyDefaults } from '../lib/catalog-add';
import { ErrorBox, Field } from './ui';
import { ItemPicker, type PickedItem } from './ItemPicker';
import { KIND_LABEL } from './ItemTree';
import { WishlistExpansions } from './WishlistExpansions';
import { WishlistScan } from './WishlistScan';

/**
 * Put something on the wishlist.
 *
 * *"We need a way to add things to the wishlist if we don't have one. I don't
 * see it on the wishlist page."* — the owner, and they were right: every door
 * into `wanted` went through somewhere else. You could set the status while
 * adding a game on `/scan`, flip an existing copy on its item page, or press
 * "+ Wishlist" beside a missing expansion on a game's *What else exists*
 * section. All three start from a game you are already looking at. None of them
 * start from "I want a thing", which is the thought somebody has while standing
 * on this page.
 *
 * ## The wishlist is item-level, so "add" is two different actions
 *
 * A row here is a `copy` with `status = 'wanted'`, not an item — see
 * `WishlistEntry`. So there are two cases and they are genuinely different:
 *
 * | | What has to happen |
 * |---|---|
 * | The catalog already has a record | create a **wanted copy** on it, and nothing else |
 * | The catalog has never heard of it | create the **item**, then the wanted copy |
 *
 * The form does not ask which. One field decides it: pick a suggestion and you
 * are in the first case, type a name nothing matches and the second one offers
 * itself. That is why `ItemPicker` is reused rather than a second type-ahead
 * being written beside it — the search that finds the existing row is the same
 * search that establishes there is no existing row.
 *
 * ## Small, because of where it is read
 *
 * This page's stated purpose is being thumbed through one-handed in a game
 * shop. So the closed state is a single button, the open state is one field,
 * and everything about a *new* game stays behind that field until the catalog
 * has said it does not have one. Nothing here asks for a publisher or a player
 * count: the details lookup and the weekly sweeps fill those in, and a form
 * that demands them at the moment of wanting something is a form nobody uses.
 *
 * ## Three doors, and typing is still the one that opens
 *
 * The camera arrived later — *"utilize our existing technology for scanning
 * barcodes and individual photos"* — and is offered as two tabs beside the
 * field rather than in place of it. Typing stays the default because it is the
 * only one that works with no light, no barcode and no signal, and because the
 * screen it produces is the one this page has always had. See `WishlistScan`
 * for the rungs and for which one is deliberately missing.
 *
 * ## What happens *after* an add is now the interesting half
 *
 * Adding used to close the form. It no longer does: whatever was added is
 * handed to `WishlistExpansions`, which asks BoardGameGeek what else exists for
 * it and offers those as a checklist. The owner's phrasing was "grab the
 * expansions so we can quick add those", and the point is that wanting Everdell
 * and wanting a couple of its expansions are one thought, four navigation steps
 * apart.
 */
export function WishlistAddForm({
  me,
  onAdded,
  onClose,
}: {
  /**
   * Whose capabilities decide which doors are open. This form is only ever
   * mounted behind `suggestWishlist` (`WishlistPage`), so "wanting an
   * existing item" always works — what varies by role is the rest: creating a
   * brand-new catalog row is `editCatalog` (contributor+, one rung above
   * plain `suggestWishlist`), the barcode tab is `scanBarcode`
   * (contributor+), and the photo tab is `scanPhoto` (moderator+, it bills
   * the vision API). A `member` sees only "Type it" against the existing
   * catalog — which is exactly what `suggestWishlist` alone was designed to
   * grant.
   */
  me: MeResponse;
  /** The list just went stale. */
  onAdded: (message: string) => void;
  onClose: () => void;
}) {
  const canCreateItems = me.capabilities.includes('editCatalog');
  const canScanBarcode = me.capabilities.includes('scanBarcode');
  const canScanPhoto = me.capabilities.includes('scanPhoto');
  /**
   * Which door. Typing is the default and the fallback for both others.
   *
   * Held here rather than inside a tab strip component so that switching tabs
   * can throw away a half-finished scan — a candidate list left standing behind
   * a form somebody has moved on from is an invitation to add the wrong thing.
   */
  const [mode, setMode] = useState<'type' | 'barcode' | 'photo'>('type');
  /**
   * The thing that just landed on the list, kept so its expansions can be
   * offered. Null until something has been added, and the whole form becomes
   * that panel once it is set — the job asked for is done, and what is left is
   * an offer.
   */
  const [added, setAdded] = useState<{ id: number; name: string } | null>(null);
  const [picked, setPicked] = useState<PickedItem | null>(null);
  /** What is in the box, matched or not — the name a new item would take. */
  const [query, setQuery] = useState('');
  /** Opened only once the catalog has said it has nothing. Never guessed at. */
  const [creating, setCreating] = useState(false);

  const [kind, setKind] = useState<ItemKind>('base');
  const [parent, setParent] = useState<PickedItem | null>(null);
  /** The base game to wait for, when it is not in the catalog either. */
  const [waitingFor, setWaitingFor] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const typed = query.trim();

  /**
   * A non-base item needs a parent *or* a name to wait for — `createItemSchema`
   * refuses anything else, and refusing here means the message lands under the
   * field rather than as a validation error from the server.
   *
   * Checked in the browser as well as on the server on purpose: the server's
   * refusal is correct and unhelpful, because by the time it arrives the person
   * has already pressed the button.
   */
  const needsParent = creating && kind !== 'base';
  const parentAnswered = !needsParent || parent != null || waitingFor.trim() !== '';

  const canSubmit = picked != null || (creating && typed !== '' && parentAnswered);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;

    setBusy(true);
    setError(null);
    try {
      let itemId: number;
      let label: string;

      if (picked) {
        // Case one. The item exists; wanting it is a fact about a copy, so a
        // copy is the only thing created. Deliberately not an update to some
        // existing copy — owning one and wanting another are both true at once,
        // which is exactly how the `×2` rows in this list came about.
        itemId = picked.id;
        label = picked.name;
      } else {
        // Case two. `pendingParentName` is the field built for this: an
        // expansion whose base game we do not own cannot name a real parent, and
        // saving it as a base game instead would put it in the collection as a
        // root and throw away what it is. Same convention as the scan review
        // screen — see `adoptOrphans`, which reunites the two when the base game
        // finally arrives.
        const orphan = kind !== 'base' && parent == null;
        const { item } = await api.createItem({
          name: typed,
          kind,
          parentItemId: kind === 'base' ? null : (parent?.id ?? null),
          pendingParentName: orphan ? waitingFor.trim() : null,
        });
        itemId = item.id;
        label = item.name;
      }

      await api.createCopy(itemId, {
        // A wanted thing is a box you intend to buy, so `physical` — a licence
        // is the rarer case and is edited in on the item page. Same defaults
        // every "add what I just saw" path uses; see `lib/catalog-add.ts`.
        ...copyDefaults('wanted', Number(quantity) || 1),
        notes: notes.trim() || null,
      });

      onAdded(`“${label}” is on the wishlist.`);
      // Not `onClose()` any more. The list behind this is already correct; what
      // is left is the offer of this game's expansions, which needs the row that
      // was just created to hang off.
      setAdded({ id: itemId, name: label });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * What is on the list now, and what else could be.
   *
   * Rendered instead of the form rather than under it: the form's fields still
   * hold the thing that was just added, and leaving them editable beside a
   * "done" message is an invitation to press Add twice.
   */
  if (added) {
    return (
      <div className="card wishlist-add">
        <div className="section-head">
          <h2>Added</h2>
        </div>
        <p className="muted small">
          <strong>{added.name}</strong> is on the wishlist.
        </p>

        <WishlistExpansions itemId={added.id} gameName={added.name} onAdded={onAdded} />

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              // Back to an empty form rather than closing: one trip to this
              // screen is usually more than one thing wanted.
              setAdded(null);
              setPicked(null);
              setQuery('');
              setCreating(false);
              setNotes('');
              setQuantity('1');
            }}
          >
            Add another
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="card wishlist-add" onSubmit={submit}>
      <div className="section-head">
        <h2>Add to the wishlist</h2>
      </div>

      {/* Three doors on one question. Typing first because it is the only one
          that needs no light, no barcode and no camera permission — and because
          it is the screen this page has always had. The other two are filtered
          by capability rather than always offered and left to 403 on submit:
          barcode needs `scanBarcode`, photo needs `scanPhoto` (it bills the
          vision API) — see the note on `me` above. */}
      <div className="wishlist-add__modes" role="tablist">
        {(
          [
            ['type', 'Type it'] as const,
            ...(canScanBarcode ? [['barcode', 'Barcode'] as const] : []),
            ...(canScanPhoto ? [['photo', 'Photo'] as const] : []),
          ]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={mode === id ? 'scan-mode scan-mode--on' : 'scan-mode'}
            onClick={() => {
              setMode(id);
              setError(null);
            }}
          >
            <strong>{label}</strong>
          </button>
        ))}
      </div>

      {error != null && <ErrorBox error={error} what="Could not add that to the wishlist" />}

      {mode !== 'type' && (
        <>
          <WishlistScan
            // Remounted per tab, so switching away throws the camera and any
            // half-read candidate list out rather than leaving them behind the
            // other tab.
            key={mode}
            mode={mode}
            onAdded={(item, message) => {
              onAdded(message);
              setAdded({ id: item.id, name: item.name });
            }}
            onError={setError}
          />
          <div className="form-actions">
            <button type="button" className="btn btn-quiet" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}

      {mode === 'type' && (
        <>
      <Field
        label="What do you want?"
        hint="Type a name. Anything already in the catalog will offer itself."
      >
        <ItemPicker
          value={picked}
          onPick={(item) => {
            setPicked(item);
            // Choosing a real row makes the new-game half meaningless, and a
            // half-filled panel left open below a chosen item is an invitation
            // to submit the wrong one.
            if (item) setCreating(false);
          }}
          onQueryChange={setQuery}
          autoFocus
          disabled={busy}
          emptyHint={
            creating ? (
              'Adding this as a new record.'
            ) : canCreateItems ? (
              <>
                Not in the catalog.{' '}
                <button
                  type="button"
                  className="btn btn-quiet btn-inline"
                  onClick={() => setCreating(true)}
                >
                  Add “{typed}” as new
                </button>
              </>
            ) : (
              // `suggestWishlist` alone (a `member`) can want an existing row
              // but not create a new catalog item — that is `editCatalog`,
              // contributor+. Said plainly rather than hidden: a member typing
              // a game with no match should learn why nothing happened, not
              // wonder if the search is broken.
              'Not in the catalog. Ask an editor to add it first.'
            )
          }
        />
      </Field>

      {/* Only after the catalog has been asked and had nothing. Showing these
          up front would make the common case — wanting an expansion for a game
          we already have — look like the harder one. */}
      {creating && !picked && (
        <div className="wishlist-add__new">
          <div className="quickadd-row">
            <Field label="Type">
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as ItemKind);
                  if (e.target.value === 'base') {
                    setParent(null);
                    setWaitingFor('');
                  }
                }}
                disabled={busy}
              >
                {ITEM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {needsParent && (
            <Field
              label="Which game is it for?"
              hint={
                parent
                  ? undefined
                  : 'If we do not have the base game either, name it below and the two ' +
                    'are joined automatically when it arrives.'
              }
            >
              <ItemPicker
                value={parent}
                onPick={setParent}
                placeholder="Start typing the base game…"
                disabled={busy}
              />
            </Field>
          )}

          {/* The `pendingParentName` door, and only while it is the only one
              open. Offering it beside a chosen parent would be two ways to
              answer one question, of which one is silently ignored by
              `createItem`. */}
          {needsParent && parent == null && (
            <Field label="…or the name to wait for" hint="Recorded until that game is added.">
              <input
                value={waitingFor}
                onChange={(e) => setWaitingFor(e.target.value)}
                placeholder="e.g. Fractured Sky"
                disabled={busy}
              />
            </Field>
          )}
        </div>
      )}

      <div className="quickadd-row">
        <Field label="How many" hint="2+ if you want more than one">
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label="Note" hint="Optional — “birthday”, “only if under £40”">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="—"
            disabled={busy}
          />
        </Field>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || !canSubmit}>
          {busy ? 'Adding…' : 'Add to wishlist'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {needsParent && !parentAnswered && (
          <span className="muted small">
            An expansion needs a base game — pick one, or name the one to wait for.
          </span>
        )}
      </div>
        </>
      )}
    </form>
  );
}

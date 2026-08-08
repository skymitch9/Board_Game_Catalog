import { useState } from 'react';
import {
  fillableFieldsFor,
  type ComponentStatus,
  type CompletenessSection,
  type CopyStatus,
  type GameCompleteness,
  type ItemDetail,
} from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { parseStamp } from '../lib/dates';
import { Link } from '../router';
import { Badge, ErrorBox, Spinner } from './ui';

/**
 * What am I missing.
 *
 * The whole feature in one sentence: *seven expansions exist, you have four,
 * here are the three you do not*. That last clause is a shopping list, and it
 * is the only reason this exists.
 *
 * Everything here reads a cached answer. Nothing on this page ever calls
 * BoardGameGeek — the lists are swept weekly by cron and by
 * `POST /api/components/backfill`, because a ~1.1s upstream call on every item
 * view would be slow, would go blank whenever BGG did, and could never notice
 * that something new had been published.
 */

/**
 * Three states, and they must stay distinguishable.
 *
 * 525 of 640 catalog rows are not on BoardGameGeek at all — Kickstarter promos,
 * a Pangea table's nineteen furniture components, seventy-five D&D Beyond
 * books. Telling their owner they own everything that exists, on the strength
 * of never having looked, would make this feature actively misleading. So
 * "checked and complete", "checked and N missing" and "no data" each get their
 * own words, and no unchecked game is ever congratulated.
 */
export function Completeness({ item, canEdit }: { item: ItemDetail; canEdit: boolean }) {
  const [report, refresh] = useAsync(() => api.completeness(item.id), [item.id]);

  if (report.state === 'loading') {
    return (
      <section className="card">
        <h2>What else exists</h2>
        <Spinner label="Checking what we know…" />
      </section>
    );
  }
  if (report.state === 'error') {
    return (
      <section className="card">
        <h2>What else exists</h2>
        <ErrorBox error={report.error} what="Could not work out what is missing" />
      </section>
    );
  }

  const data = report.data;

  return (
    <section className="card completeness">
      <div className="section-head">
        <h2>What else exists</h2>
        {canEdit && data.bggId != null && (
          <CheckNow itemId={data.itemId} onDone={refresh} state={data.state} />
        )}
      </div>

      {data.state === 'not_on_bgg' && (
        <p className="muted">
          <strong>No data.</strong> This is not matched to BoardGameGeek, so there is
          nothing to compare against — which is not the same as owning everything.
          {canEdit && ' Add a BoardGameGeek ID on the edit screen and this can answer.'}
        </p>
      )}

      {data.state === 'never_checked' && (
        <p className="muted">
          <strong>Not checked yet.</strong> BoardGameGeek has not been asked what exists
          for this game. The weekly sweep will pick it up
          {canEdit ? ', or check it now.' : '.'}
        </p>
      )}

      {data.state === 'not_found' && (
        <p className="muted">
          <strong>No data.</strong> BoardGameGeek returned nothing for id {data.bggId} —
          the entry has probably been merged or removed. Checked{' '}
          {formatWhen(data.checkedAt)}.
        </p>
      )}

      {data.state === 'checked' && (
        <>
          <Section
            title="expansions"
            section={data.expansions}
            gameId={data.itemId}
            canEdit={canEdit}
            onChanged={refresh}
          />
          <Section
            title="accessories"
            section={data.accessories}
            gameId={data.itemId}
            canEdit={canEdit}
            onChanged={refresh}
          />

          {data.expansions.total === 0 && data.accessories.total === 0 && (
            <p className="muted">
              BoardGameGeek lists nothing official for this game — no expansions, no
              accessories. Nothing to chase.
            </p>
          )}

          <ThirdParty
            thirdParty={data.thirdParty}
            gameId={data.itemId}
            canEdit={canEdit}
            onChanged={refresh}
          />

          <p className="completeness__footnote">
            Checked {formatWhen(data.checkedAt)}. Official components only — anything a
            different publisher made is counted separately.
            {data.unclassified > 0 && (
              <>
                {' '}
                {data.unclassified} not yet classified, and counted in neither figure.
              </>
            )}
            {data.stale > 0 && (
              <> {data.stale} no longer listed by BoardGameGeek, kept rather than deleted.</>
            )}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * One counted category: official expansions, or official accessories.
 *
 * The count leads, because "4 of 7" is the answer to the question. The names
 * follow, because a number with no names is not a shopping list.
 */
function Section({
  title,
  section,
  gameId,
  canEdit,
  onChanged,
}: {
  title: string;
  section: CompletenessSection;
  gameId: number;
  canEdit: boolean;
  onChanged: () => void;
}) {
  if (section.total === 0) return null;

  const complete = section.held === section.total;

  return (
    <div className="completeness__section">
      <p className="completeness__count">
        <strong className={complete ? 'tone-good' : 'tone-warn'}>
          {section.held} of {section.total}
        </strong>{' '}
        official {section.total === 1 ? singular(title) : title}
        {complete && <span className="completeness__done"> — complete</span>}
        {/* Counted apart from `held`, never into it. A name that matches is not
            proof, and inflating the figure is the one failure that costs money
            silently. Saying it out loud also points at the fix: set the id. */}
        {section.uncertain > 0 && (
          <span className="muted"> · {section.uncertain} possibly already yours</span>
        )}
      </p>

      {section.outstanding.length > 0 && (
        <ul className="completeness__list">
          {section.outstanding.map((c) => (
            <MissingRow
              key={c.id}
              component={c}
              gameId={gameId}
              canEdit={canEdit}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One thing you do not have, and one click to want it.
 *
 * **`uncertain` rows are listed here, among the missing, on purpose.** A false
 * "you already own this" silently costs a purchase the owner wanted; a false
 * "missing" is a visible annoyance they can correct in a glance. So a match on
 * name alone, or a catalogued row with no copy recorded, is shown with the
 * reason and left in the list rather than quietly counted as held.
 */
function MissingRow({
  component,
  gameId,
  canEdit,
  onChanged,
}: {
  component: ComponentStatus;
  gameId: number;
  canEdit: boolean;
  onChanged: () => void;
}) {
  return (
    <li className={`completeness__row${component.stale ? ' completeness__row--stale' : ''}`}>
      <a
        className="completeness__name"
        href={`https://boardgamegeek.com/boardgame/${component.bggId}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        {component.name}
        {component.yearPublished ? (
          <span className="item-year"> ({component.yearPublished})</span>
        ) : null}
        <span aria-hidden="true"> ↗</span>
      </a>

      {component.state === 'uncertain' && <Badge tone="neutral">uncertain</Badge>}
      {component.state === 'held' && <Badge tone="owned">owned</Badge>}
      {component.stale && <Badge tone="neutral">delisted</Badge>}

      {component.note && <span className="completeness__note">{component.note}</span>}

      {/* Where the catalog row is, once there is one. The name above links to
          BoardGameGeek, which is right while this is only a thing that exists —
          but the moment a tap here creates a row, the useful question becomes
          "what did I just make?", and the answer was two screens away. It is
          also the undo: changing or deleting the copy happens on that page. */}
      {component.matchedItemId != null && (
        <Link to={`/items/${component.matchedItemId}`} className="completeness__ours">
          in the catalog
        </Link>
      )}

      {canEdit && component.state !== 'held' && (
        <AddComponent component={component} gameId={gameId} onAdded={onChanged} />
      )}
    </li>
  );
}

/**
 * "I'm missing this" → recorded, in one tap. Two taps, because there are two
 * ways of missing something.
 *
 * *"Should the 'what exists' page also maybe include a quick button to add to
 * catalog next to add to wishlist?"* — the owner. A row lands in this list
 * whenever the catalog does not hold it, and that has two quite different
 * causes: the thing is not theirs, or it *is* theirs and nobody ever wrote it
 * down. Until now only the first had a button, so a shelf full of uncatalogued
 * accessories meant leaving the page for each one.
 *
 * ⚠️ **Neither button is "add to catalog", and the second one must never be
 * labelled that way.** Wishlisting already adds to the catalog — it creates the
 * item *and* a copy. The only difference between these two paths is one column,
 * `copy.status`, so a label claiming one adds to the catalog and the other does
 * not would be a false statement about what the buttons do. They are named for
 * the thing that actually differs: whether the owner has it.
 *
 * Built with the two write routes that already exist — create the item, then
 * create a copy — and no third one. That is the rule the wishlist and the cover
 * picker follow: a second way to set a copy's status is a second thing to keep
 * correct.
 *
 * The loop visibly closes, differently for each. A **wanted** row comes back as
 * `uncertain` reading "Already on your wishlist" and is *still counted as
 * missing*, because it still is. An **owned** row comes back `held`: it counts
 * towards the figure, both buttons disappear, and an `owned` badge replaces
 * them.
 */
function AddComponent({
  component,
  gameId,
  onAdded,
}: {
  component: ComponentStatus;
  gameId: number;
  onAdded: () => void;
}) {
  const [busy, setBusy] = useState<CopyStatus | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Nothing to add: the catalog already holds this, it just has no copy or a
  // wanted one. Offering to add it would create a duplicate item and fail on
  // the unique BoardGameGeek id index.
  if (component.matchedItemId != null) return null;

  async function add(status: CopyStatus) {
    setBusy(status);
    setError(null);
    try {
      const publisher = component.publishers?.[0]?.name ?? null;
      /*
        The same door a lookup has to come through.

        `fillableFieldsFor` is the policy on what a row of this kind may hold,
        and BoardGameGeek's component list is no more entitled to bypass it than
        a name search is. It changes nothing for the overwhelming majority —
        `description` and the player counts are the fields it refuses an
        accessory, and none of them are sent here. It bites on exactly one case,
        and it is a real one: BGG credits fan-made components to
        `(Public Domain)`, which is a spelling `isTraditionalPublisher`
        recognises, and a row with that publisher is one the catalog says cannot
        have a publisher or a year at all.
      */
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
      await api.createCopy(item.id, {
        status,
        quantity: 1,
        format: 'physical',
        isSleeved: false,
        isPunched: false,
      });
      onAdded();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {/*
        Deliberately not a matched pair.

        Two one-tap buttons side by side that write different things is a
        mis-tap waiting to happen, and this pair is asymmetric in consequence:
        the wrong wishlist entry is noise, while the wrong "I have it" is the
        catalog stating that something is on a shelf it is not on — which is the
        one claim this whole feature exists to get right.

        So they differ in every way a thumb reads at speed: colour (the owned
        one carries the same green as the `owned` badge it will produce, the
        wishlist one stays the quiet outline it has always been), shape, and
        phrasing — a first-person statement of fact beside a noun. "+ Own" and
        "+ Wishlist" would scan as one control with two endings.
      */}
      <button
        type="button"
        className="btn completeness__have"
        disabled={busy != null}
        onClick={() => void add('owned')}
      >
        {busy === 'owned' ? 'Adding…' : 'I have it'}
      </button>
      <button
        type="button"
        className="btn btn-quiet completeness__want"
        disabled={busy != null}
        onClick={() => void add('wanted')}
      >
        {busy === 'wanted' ? 'Adding…' : '+ Wishlist'}
      </button>
      {error != null && <ErrorBox error={error} what="Could not record that" />}
    </>
  );
}

/**
 * Third-party, behind a disclosure.
 *
 * The owner's rule, verbatim: it does not count towards the completeness
 * figure but must stay checkable on demand — "something that lets us ignore it
 * for the most part but check if we want something specific when desired".
 *
 * Same control as the collection page's group collapse: a real `<button>` with
 * `aria-expanded`, and the rows unmounted while closed so twenty-three inserts
 * cost no render.
 */
function ThirdParty({
  thirdParty,
  gameId,
  canEdit,
  onChanged,
}: {
  thirdParty: GameCompleteness['thirdParty'];
  gameId: number;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (thirdParty.total === 0) return null;

  return (
    <>
      <button
        type="button"
        className="children-toggle completeness__toggle"
        aria-expanded={open}
        aria-controls={`third-party-${gameId}`}
        onClick={() => setOpen(!open)}
      >
        <span className="children-toggle__caret" aria-hidden="true" data-open={open}>
          ▸
        </span>
        <span>
          {thirdParty.total} third-party {thirdParty.total === 1 ? 'item' : 'items'} — inserts,
          upgrades, sleeves
          {thirdParty.held > 0 && ` · you have ${thirdParty.held}`}
        </span>
      </button>
      <div id={`third-party-${gameId}`} hidden={!open}>
        {open && (
          <>
            <p className="completeness__note completeness__note--block">
              Made by someone other than this game&rsquo;s publisher, so none of these count
              towards the figures above.
            </p>
            <ul className="completeness__list">
              {thirdParty.components.map((c) => (
                <MissingRow
                  key={c.id}
                  component={c}
                  gameId={gameId}
                  canEdit={canEdit}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Ask BoardGameGeek about this one game now.
 *
 * The same code path the weekly cron runs, scoped to one item — which is what
 * makes pressing it evidence that the scheduled sweep works, rather than a
 * second implementation that might not.
 */
function CheckNow({
  itemId,
  onDone,
  state,
}: {
  itemId: number;
  onDone: () => void;
  state: GameCompleteness['state'];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.backfillComponents({ itemId, force: true });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void run()}>
        {busy ? 'Asking…' : state === 'never_checked' ? 'Check now' : 'Re-check'}
      </button>
      {error != null && <ErrorBox error={error} what="Could not ask BoardGameGeek" />}
    </>
  );
}

/** "expansions" -> "expansion". Only ever called on the two words used here. */
function singular(word: string): string {
  return word === 'accessories' ? 'accessory' : word.replace(/s$/, '');
}

/** "3 days ago", or the date once that stops being useful. */
function formatWhen(iso: string | null): string {
  if (!iso) return 'never';
  // `parseStamp`, not `new Date`: SQLite hands back "YYYY-MM-DD HH:MM:SS" in UTC
  // with no zone marker, and without the Z a browser reads it as local time — a
  // check made an hour ago then reads as being in the future. This used to be
  // handled inline here and nowhere else, which is how two other screens ended
  // up displaying every timestamp shifted by the viewer's offset.
  const when = parseStamp(iso);
  if (!when) return iso;

  const days = Math.floor((Date.now() - when.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return when.toLocaleDateString();
}

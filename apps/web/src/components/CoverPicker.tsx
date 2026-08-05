import { useState } from 'react';
import type { CoverCandidate } from '@bgc/core';
import { api } from '../api';
import { useAsync } from '../hooks';
import { Badge, ErrorBox, Spinner } from './ui';

/**
 * Choose which printing's cover represents our copy.
 *
 * One feature, not two. The owner asked to swap between the BoardGameGeek image
 * and the Kickstarter one, and separately to see covers from several years — but
 * those are the same question: an item has several known printings, each has a
 * cover, and you pick the one that looks like the box on the shelf. A campaign
 * edition is a printing, so it sits in the grid beside the 2019 and 2023 retail
 * ones rather than behind a Kickstarter-specific button.
 *
 * Picking sets the form's image URL rather than writing immediately. The write
 * is the form's Save, which is the only thing that writes an item — a picker
 * that PATCHed on click would be silently undone by the Save that followed it,
 * because the form still held the old URL in its own state.
 */
export function CoverPicker({
  itemId,
  value,
  onPick,
}: {
  itemId: number;
  /** The URL the form currently holds — not necessarily the saved one. */
  value: string;
  onPick: (url: string) => void;
}) {
  const [covers, refresh] = useAsync(() => api.covers(itemId), [itemId]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  /** URLs whose <img> actually failed in this browser, whatever the checker thought. */
  const [broken, setBroken] = useState<Set<string>>(new Set());

  if (covers.state === 'loading') return <Spinner label="Looking for other covers…" />;
  if (covers.state === 'error') {
    return <ErrorBox error={covers.error} what="Could not load the other covers" />;
  }

  const { candidates, bggId, printingsFetched, kind } = covers.data;

  /**
   * How hard a missing cover is worth chasing, which is not the same for every
   * kind of thing. Artwork matters for the games and expansions people browse;
   * an insert or a pack of sleeves having no picture is simply fine. Saying so
   * is the difference between an honest blank and a nag.
   */
  const coverMatters = kind === 'base' || kind === 'expansion' || kind === 'promo';

  async function lookUpPrintings() {
    setFetching(true);
    setFetchError(null);
    setNote(null);
    try {
      const { run } = await api.backfillEditions({ itemId });
      setNote(
        run.editionsAdded > 0
          ? `Found ${run.editionsAdded} printing${run.editionsAdded === 1 ? '' : 's'}.`
          : (run.failures[0]?.detail ??
            'BoardGameGeek lists no separate printings for this game.'),
      );
      refresh();
    } catch (err) {
      setFetchError(err);
    } finally {
      setFetching(false);
    }
  }

  /**
   * Why there is nothing to choose between, in the terms that caused it.
   *
   * Coverage is deliberately uneven — most pledge accessories will never have a
   * second cover — so an empty grid with no explanation would read as a bug
   * rather than as the truth about the data.
   */
  const emptyReason =
    bggId == null
      ? coverMatters
        ? 'No covers known — this one has never been matched to BoardGameGeek. Worth fixing: set the BGG ID above, or use Free lookup on the game’s page.'
        : 'No covers known, and none are likely: this has never been matched to BoardGameGeek, which is normal for an accessory or component. Not worth chasing.'
      : printingsFetched
        ? 'BoardGameGeek lists no separate printings for this one.'
        : 'Nobody has asked BoardGameGeek about this one’s printings yet.';

  const canLookUp = bggId != null && !printingsFetched;

  return (
    <section className="cover-picker">
      <div className="cover-picker__head">
        <span className="field-label">Cover</span>
        {canLookUp && (
          <button
            type="button"
            className="btn btn-quiet"
            disabled={fetching}
            onClick={() => void lookUpPrintings()}
          >
            {fetching ? 'Asking BoardGameGeek…' : 'Look up printings'}
          </button>
        )}
      </div>

      {fetchError != null && <ErrorBox error={fetchError} what="Could not fetch printings" />}
      {note && <p className="muted small">{note}</p>}

      {candidates.length === 0 && <p className="muted small">{emptyReason}</p>}

      {candidates.length === 1 && (
        <p className="muted small">
          One cover is known for this game, so there is nothing to pick between.{' '}
          {canLookUp ? 'Looking up its printings may find more.' : ''}
        </p>
      )}

      {candidates.length > 0 && (
        <ul className="cover-grid">
          {candidates.map((c) => (
            <CoverCard
              key={c.url}
              candidate={c}
              chosen={c.url === value}
              broken={broken.has(c.url)}
              onBroken={() => setBroken((prev) => new Set(prev).add(c.url))}
              onPick={() => onPick(c.url)}
            />
          ))}
        </ul>
      )}

      {candidates.length > 1 && (
        <p className="muted small">
          Pick one, then Save changes below. Nothing is lost either way &mdash; every
          printing stays recorded.
        </p>
      )}
    </section>
  );
}

const SOURCE_LABEL: Record<CoverCandidate['source'], string> = {
  bgg: 'BoardGameGeek',
  campaign: 'Campaign',
  current: 'In use',
  other: 'Printing',
};

function CoverCard({
  candidate,
  chosen,
  broken,
  onBroken,
  onPick,
}: {
  candidate: CoverCandidate;
  /** Chosen in the form right now, which is not yet the same as saved. */
  chosen: boolean;
  broken: boolean;
  onBroken: () => void;
  onPick: () => void;
}) {
  // Two ways to learn an image is bad, and both matter. The checker's verdict
  // arrives before the picture is requested, but only covers URLs it has got
  // round to; the browser's own onError catches the rest. Either way the slot
  // says so rather than rendering an empty box with a caption under it.
  const dead = broken || candidate.status === 'dead';

  const caption = [candidate.year, candidate.publisher, candidate.language]
    .filter(Boolean)
    .join(' · ');

  return (
    <li>
      <button
        type="button"
        className={`cover-card${chosen ? ' cover-card--chosen' : ''}`}
        onClick={onPick}
        aria-pressed={chosen}
      >
        <span className="cover-card__frame">
          {dead ? (
            <span className="cover-card__dead">Image no longer loads</span>
          ) : (
            <img src={candidate.url} alt="" loading="lazy" onError={onBroken} />
          )}
        </span>
        <span className="cover-card__meta">
          <Badge tone={candidate.source === 'campaign' ? 'wanted' : 'kind'}>
            {SOURCE_LABEL[candidate.source]}
          </Badge>
          {candidate.selected && <Badge tone="owned">Saved</Badge>}
          {!dead && candidate.status === 'suspect' && <Badge tone="lent">Flaky</Badge>}
        </span>
        <span className="cover-card__label">{candidate.label}</span>
        {caption && <span className="cover-card__caption">{caption}</span>}
      </button>
    </li>
  );
}

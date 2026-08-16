import { scanRowName, type MeResponse } from '@bgc/core';
import { api, type EnrichedTitle, type ScanJob } from '../api';
import { useAsync } from '../hooks';
import { formatDateTime } from '../lib/dates';
import { Badge, EmptyState, ErrorBox, Pager, Spinner } from '../components/ui';
import { Link, navigate } from '../router';
import { MODE_LABEL, STATUS_LABEL, STATUS_TONE } from './ScanJobsPage';

/**
 * The scan record: which photo — or barcode session — produced which items.
 *
 * The queue answers "what still wants me?"; this answers "where did that game
 * come from?", months later. It can, because a finished job is marked `done`
 * and never deleted — the row keeps every title the photo produced and what
 * became of each one, and this page is the screen that record was kept for.
 * (Auto-deleting finished jobs was considered and rejected for exactly this
 * reason. Do not add a cleanup here.)
 *
 * Everything shown is what was *decided* at the time — `addedItemId` and
 * `dismissed` are stored facts about what a person did. Deliberately no fresh
 * ownership resolution: history is not the place to re-litigate the catalog,
 * and the review screen (one click away on any job) already does.
 */

const historyPath = (page: number): string =>
  page > 1 ? `/scan-jobs/history?page=${page}` : '/scan-jobs/history';

/** What became of one title, in the order a reader wants the answer. */
function TitleFate({ t }: { t: EnrichedTitle }) {
  if (t.addedItemId) {
    return <Link to={`/items/${t.addedItemId}`}>added &mdash; open it</Link>;
  }
  if (t.dismissed) {
    return <span className="muted">set aside</span>;
  }
  if (t.alreadyOwned && t.existingItemId) {
    return (
      <span className="muted">
        already owned &mdash; <Link to={`/items/${t.existingItemId}`}>{t.existingName ?? 'open it'}</Link>
      </span>
    );
  }
  // True of any title the reviewer never got to before the job closed — a
  // stopped job, or one auto-closed once everything else was settled. Said
  // plainly rather than hidden: an honest "nothing" is part of the record.
  return <span className="muted">no decision recorded</span>;
}

function HistoryJob({ job }: { job: ScanJob }) {
  // A malformed blob loses this job's title list, not the page. One bad row
  // out of two hundred should not take the record down with it.
  let titles: EnrichedTitle[] | null = null;
  if (job.enriched) {
    try {
      titles = JSON.parse(job.enriched) as EnrichedTitle[];
    } catch {
      titles = null;
    }
  }

  const added = titles?.filter((t) => t.addedItemId).length ?? 0;
  const dismissed = titles?.filter((t) => !t.addedItemId && t.dismissed).length ?? 0;

  return (
    <li className="job-row">
      <div className="candidate__body">
        <div className="job-row__info">
          <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
          <span className="muted">{MODE_LABEL[job.mode]}</span>
          {/* `formatDateTime`, never `new Date()`: the column is SQLite's
              zone-less "YYYY-MM-DD HH:MM:SS" — see the queue page. */}
          <span className="job-row__time">{formatDateTime(job.createdAt)}</span>
          {job.reviewedAt && (
            <span className="muted small">finished {formatDateTime(job.reviewedAt)}</span>
          )}
          {titles && (
            <span className="muted small">
              {titles.length} title{titles.length === 1 ? '' : 's'}
              {added > 0 && ` · ${added} added`}
              {dismissed > 0 && ` · ${dismissed} set aside`}
            </span>
          )}
          {job.enriched != null && (
            <Link to={`/scan-jobs/${job.id}`} className="btn btn-quiet btn-xs">
              Open
            </Link>
          )}
        </div>

        {/* The error column, verbatim. It is why a job stopped when it did —
            including "Stopped before it finished." on a job somebody cancelled,
            which is a fact about the record, not a fault to hide. */}
        {job.error && <span className="job-row__left">{job.error}</span>}

        {titles && titles.length > 0 && (
          <ul className="child-list">
            {titles.map((t, i) => (
              <li key={i}>
                <strong>{scanRowName(t)}</strong>{' '}
                {t.barcode && (
                  <span className="muted small">
                    <code>{t.barcode}</code>{' '}
                  </span>
                )}
                <TitleFate t={t} />
              </li>
            ))}
          </ul>
        )}
        {titles === null && job.enriched != null && (
          <span className="muted small">This job&apos;s titles could not be read back.</span>
        )}
        {job.enriched == null && !job.error && (
          <span className="muted small">Nothing was read from this one.</span>
        )}
      </div>
    </li>
  );
}

export function ScanHistoryPage({ me, page }: { me: MeResponse; page: number }) {
  const [hist] = useAsync(() => api.scanJobHistory(page), [page]);

  if (!me.capabilities.includes('editCatalog')) {
    return <p className="muted">Only editors can see the scan history.</p>;
  }

  return (
    <div className="scan-jobs-page">
      <header className="page-head">
        <div>
          <h1>Scan history</h1>
          <p className="subtitle">
            Every photo and barcode session ever taken in, newest first, and what each
            one produced. Nothing here is deleted when a job finishes — this is the
            record of which scan a game came from.
          </p>
        </div>
        <Link to="/scan-jobs" className="btn btn-quiet">Back to the queue</Link>
      </header>

      {hist.state === 'loading' && <Spinner label="Loading history..." />}
      {hist.state === 'error' && <ErrorBox error={hist.error} what="Could not load history" />}

      {hist.state === 'ok' && hist.data.total === 0 && (
        <EmptyState title="No scans yet">
          <p className="muted">
            Scan a barcode or photograph a shelf on the{' '}
            <Link to="/scan-jobs">Add games</Link> page and it will be recorded here.
          </p>
        </EmptyState>
      )}

      {hist.state === 'ok' && hist.data.total > 0 && (
        <section className="card">
          <Pager
            page={hist.data.page}
            pageSize={hist.data.pageSize}
            pageCount={hist.data.pageCount}
            total={hist.data.total}
            onPage={(next) => navigate(historyPath(next))}
            position="top"
          />
          <ul className="job-list">
            {hist.data.jobs.map((job) => (
              <HistoryJob key={job.id} job={job} />
            ))}
          </ul>
          <Pager
            page={hist.data.page}
            pageSize={hist.data.pageSize}
            pageCount={hist.data.pageCount}
            total={hist.data.total}
            onPage={(next) => navigate(historyPath(next))}
            position="bottom"
          />
        </section>
      )}
    </div>
  );
}

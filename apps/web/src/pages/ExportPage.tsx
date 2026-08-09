import { api } from '../api';
import { useAsync } from '../hooks';
import { ErrorBox, Spinner } from '../components/ui';

/**
 * Take the collection away with you.
 *
 * `docs/DESIGN.md` §9 names "D1 is the only copy of your data" as the standing
 * risk, and these two files are the whole answer to it. They used to be a pair
 * of bare links tucked into the collection page's result count — beside "806
 * entries · 171 games", where the one thing on the screen that protects you
 * against losing everything read as a footnote about paging.
 *
 * **One entry in the top bar, and the choice of format made here.** The bar is
 * for places rather than actions, and a screen naming two formats and saying
 * what each is for is a place; a button that silently downloads one of them
 * would have to pick, and the two are not interchangeable. Two taps either way.
 *
 * There is nothing to configure and nothing to wait for: both routes are plain
 * `GET`s that stream the whole catalog, so these are ordinary download anchors
 * rather than anything this app has to manage.
 */
export function ExportPage() {
  const [meta] = useAsync(() => api.meta(), []);

  if (meta.state === 'loading') return <Spinner label="Counting what there is to export…" />;
  if (meta.state === 'error') {
    return <ErrorBox error={meta.error} what="Could not work out what there is to export" />;
  }

  const stats = meta.data.stats;
  // An export of nothing is a file that proves nothing. Say so rather than
  // handing over an empty spreadsheet — the old links hid themselves here, and
  // a page that renders as a blank is worse than one that explains itself.
  const empty = stats.totalItems === 0;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Export</h1>
          <p className="subtitle">
            {empty
              ? 'Nothing in the catalog yet, so there is nothing to take away.'
              : `Everything, in one file — ${stats.totalItems} items and ${stats.ownedCopies} owned copies as of right now.`}
          </p>
        </div>
      </header>

      {!empty && (
        <>
          <section className="card export-option">
            <div className="grow">
              <h2>Spreadsheet</h2>
              <p className="muted small">
                One row per copy, with the game it belongs to named beside it — for
                sorting, totting up, or handing to an insurer. Opens in Excel, Numbers
                or Sheets. It is a <strong>flattened view</strong>, not the whole
                database: ratings, editions and the shape of the tree are not in it.
              </p>
            </div>
            {/* A plain anchor, not a Link: the router must not intercept it, and
                `download` is what turns a response into a file rather than a
                page the browser tries to render. */}
            <a className="btn btn-primary" href="/api/export.csv" download>
              Download CSV
            </a>
          </section>

          <section className="card export-option">
            <div className="grow">
              <h2>Backup</h2>
              <p className="muted small">
                Every row of every table — items, editions, copies, ratings and sleeve
                requirements — with the schema version stamped on it. This is the one to
                keep if you ever want to <strong>rebuild the catalog</strong>, and the
                one worth taking before anything drastic.
              </p>
            </div>
            <a className="btn" href="/api/export.json" download>
              Download JSON
            </a>
          </section>

          <p className="muted small">
            Both files are generated when you press the button, so they are current as of
            that moment. Nothing is stored on the server and nothing is sent anywhere —
            the download goes straight to this device.
          </p>
        </>
      )}
    </>
  );
}

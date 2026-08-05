-- Whether the cover images still load.
--
-- Nothing in this catalog hosts a cover. `item.thumbnail_url` points at
-- BoardGameGeek (cf.geekdo-images.com), Kickstarter (i.kickstarter.com,
-- ksr-ugc.imgix.net) or Gamefound, and a crowdfunding CDN has no obligation to
-- keep a campaign's images addressable once the campaign is a decade old. When
-- one stops, every affected card silently renders a broken image and nobody
-- notices, because nobody re-opens a game they already catalogued.
--
-- Keyed on the URL, not the item. Two reasons, both practical:
--
--   1. Several items legitimately share one image — a game and its own promo,
--      or two entries a scan resolved to the same BGG id — and fetching that
--      URL once per item would multiply the request count against exactly the
--      CDNs we are trying not to hammer. Deduplication is the primary key here
--      rather than something the checker has to remember to do.
--   2. A cover that gets fixed changes the URL. Keyed by item, the old verdict
--      would linger against the new address and have to be invalidated by hand;
--      keyed by URL, the new address is simply unknown and gets checked.
--
-- The item id is recovered by joining `item.thumbnail_url = cover_check.url`,
-- which is what every read of this table does.

CREATE TABLE cover_check (
  url                  TEXT PRIMARY KEY,
  last_checked_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- NULL when the request never got far enough to have one: DNS failure,
  -- connection reset, timeout. That is a different fact from a 404 and is why
  -- `outcome` exists rather than being inferred from the code.
  status_code          INTEGER,
  ok                   INTEGER NOT NULL DEFAULT 0,
  -- 'ok'    — the image is there.
  -- 'dead'  — the host answered, definitively, that it is not (404, 410).
  -- 'error' — we could not find out (5xx, timeout, network).
  --
  -- Only 'dead' is worth telling anyone about, and only after it repeats. A
  -- single failure is a blip; a CDN having a bad minute must not raise a banner
  -- claiming the collection's artwork is rotting.
  outcome              TEXT NOT NULL DEFAULT 'error'
                         CHECK (outcome IN ('ok', 'dead', 'error')),
  -- Reset to zero by any success. Counts failures of either kind, so a URL that
  -- has been unreachable for days still eventually surfaces.
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  -- The message from a network-level failure, for when the status code is null
  -- and "it didn't work" is otherwise all we would know.
  last_error           TEXT
);

-- The checker walks the catalog oldest-first, a slice at a time, because a
-- Worker invocation cannot make hundreds of subrequests. This index is what
-- makes "the ones we have not looked at for longest" cheap.
CREATE INDEX idx_cover_check_age ON cover_check(last_checked_at);

-- The banner asks one question on load: is anything confirmed dead?
CREATE INDEX idx_cover_check_outcome ON cover_check(outcome, consecutive_failures);

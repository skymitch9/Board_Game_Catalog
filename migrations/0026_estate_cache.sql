-- Estate membership cache — two nullable columns on app_user.
--
-- catalog-platform/docs/info/estate-auth-design.md §5.2, adopted here per
-- §14.5 (games, shadow-first). `estate_status` is the directory's last answer
-- for this person ('pending' | 'approved' | 'revoked'); `estate_checked_at` is
-- when that answer arrived (ISO 8601). Together they are the 10-minute TTL
-- cache that keeps the auth Worker off this app's hot path: the row is already
-- loaded on every request, so the cache rides for free.
--
-- ⚠️ Deliberately PLAIN `ADD COLUMN`, not the 0023/0024 rebuild. Those had to
-- rebuild because a CHECK constraint cannot be altered; these columns carry no
-- CHECK on purpose (the module validates values on read/write — a directory
-- status vocabulary change must not need a rebuild here). Both columns nullable
-- and unread while ESTATE_CHECK=off, so this migration is inert until the flag
-- flips.
--
-- No index: lookups reach these columns through the existing app_user row
-- fetch by email/id, never by estate_status.

ALTER TABLE app_user ADD COLUMN estate_status TEXT;
ALTER TABLE app_user ADD COLUMN estate_checked_at TEXT;

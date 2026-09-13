-- Migration: add pin and archive flags to meetings
--   pinned:  1 when the user pinned/favorited the meeting (sorted first)
--   archived: 1 when the user archived it (hidden from the default list)

ALTER TABLE meetings ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_meetings_pinned ON meetings(pinned);
CREATE INDEX IF NOT EXISTS idx_meetings_archived ON meetings(archived);

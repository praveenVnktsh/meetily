-- Migration: flag meetings recorded while Debug mode was enabled.
-- Debug meetings are hidden from the normal list so testing does not pollute
-- real recordings, and can be cleared from Settings.

ALTER TABLE meetings ADD COLUMN is_debug INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_meetings_is_debug ON meetings(is_debug);

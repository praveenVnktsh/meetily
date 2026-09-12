CREATE TABLE IF NOT EXISTS speaker_identities (
    meeting_id TEXT NOT NULL,
    speaker_id TEXT NOT NULL,
    display_name TEXT,
    merged_into TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (meeting_id, speaker_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS speaker_segment_overrides (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    transcript_id TEXT NOT NULL,
    audio_start_time REAL,
    audio_end_time REAL,
    speaker_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_speaker_override_transcript
    ON speaker_segment_overrides(meeting_id, transcript_id);
CREATE INDEX IF NOT EXISTS idx_speaker_override_timing
    ON speaker_segment_overrides(meeting_id, audio_start_time, audio_end_time);

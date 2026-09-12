CREATE TABLE IF NOT EXISTS diarization_runs (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    engine TEXT NOT NULL,
    segmentation_model TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_diarization_runs_meeting_created
    ON diarization_runs(meeting_id, created_at DESC);

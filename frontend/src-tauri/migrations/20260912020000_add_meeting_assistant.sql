CREATE TABLE IF NOT EXISTS meeting_chat_messages (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_chat_messages_meeting_id_created
    ON meeting_chat_messages(meeting_id, created_at);

CREATE TABLE IF NOT EXISTS transcript_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    transcript_id TEXT NOT NULL,
    previous_text TEXT NOT NULL,
    revised_text TEXT NOT NULL,
    instruction TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transcript_revisions_segment
    ON transcript_revisions(meeting_id, transcript_id, created_at);

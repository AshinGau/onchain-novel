-- Notification system

CREATE TABLE IF NOT EXISTS notifications (
  id              SERIAL PRIMARY KEY,
  recipient       TEXT,              -- wallet address (NULL = broadcast to all novel followers)
  novel_id        BIGINT NOT NULL,
  type            TEXT NOT NULL,     -- 'phase_change' | 'reveal_reminder' | 'canon_established' | 'chapter_submitted'
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  link            TEXT,              -- frontend URL to navigate to
  read            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_novel ON notifications(novel_id, created_at DESC);

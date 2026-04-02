-- Additional indexes for query performance
CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes(LOWER(voter));
CREATE INDEX IF NOT EXISTS idx_chapters_content_unfetched ON chapters(novel_id) WHERE content_fetched = FALSE;

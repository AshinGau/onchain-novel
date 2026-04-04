-- Add unique constraint to prevent duplicate vote commits per address per round
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_unique_commit
  ON votes(novel_id, voting_round_id, LOWER(voter));

-- Add index for VoteRevealed lookups
CREATE INDEX IF NOT EXISTS idx_votes_reveal_lookup
  ON votes(novel_id, voting_round_id, LOWER(voter))
  WHERE revealed = FALSE;

-- Add indexes for notification participation queries (called every 30s per user)
CREATE INDEX IF NOT EXISTS idx_chapters_author_lower ON chapters(LOWER(author));
CREATE INDEX IF NOT EXISTS idx_tips_tipper_lower ON tips(LOWER(tipper));

-- Add index for notification read status
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(LOWER(recipient))
  WHERE read = FALSE;

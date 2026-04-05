-- Rules: world-building rules for AI agent collaboration
CREATE TABLE IF NOT EXISTS rules (
  novel_id      BIGINT NOT NULL,
  name          TEXT NOT NULL,
  content       TEXT NOT NULL,
  block_number  BIGINT NOT NULL,
  UNIQUE(novel_id, name)
);

CREATE INDEX IF NOT EXISTS idx_rules_novel_id ON rules (novel_id);

-- Rule proposals (add or delete)
CREATE TABLE IF NOT EXISTS rule_proposals (
  id              BIGINT PRIMARY KEY,
  novel_id        BIGINT NOT NULL,
  proposer        TEXT NOT NULL,
  proposal_type   SMALLINT NOT NULL,  -- 0=Add, 1=Delete
  rule_name       TEXT NOT NULL,
  rule_content    TEXT NOT NULL DEFAULT '',
  created_at_time BIGINT NOT NULL,
  vote_count      INT NOT NULL DEFAULT 0,
  executed        BOOLEAN NOT NULL DEFAULT FALSE,
  block_number    BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rule_proposals_novel_id ON rule_proposals (novel_id);

-- Rule proposal votes
CREATE TABLE IF NOT EXISTS rule_proposal_votes (
  proposal_id   BIGINT NOT NULL,
  voter         TEXT NOT NULL,
  block_number  BIGINT NOT NULL,
  UNIQUE(proposal_id, voter)
);

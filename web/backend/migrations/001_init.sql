-- Onchain Novel: Database schema

-- ============================================================
-- NOVELS
-- ============================================================

CREATE TABLE novels (
  id              BIGINT PRIMARY KEY,
  creator         TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  cover_uri       TEXT NOT NULL DEFAULT '',
  config          JSONB NOT NULL,
  current_round   INT NOT NULL DEFAULT 0,
  round_phase     SMALLINT NOT NULL DEFAULT 0,   -- 0=Idle, 1=Nominating, 2=Committing, 3=Revealing
  phase_start_time BIGINT NOT NULL DEFAULT 0,
  last_settle_time BIGINT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  pool_balance    NUMERIC NOT NULL DEFAULT 0,
  total_tipped    NUMERIC NOT NULL DEFAULT 0,
  total_funded    NUMERIC NOT NULL DEFAULT 0,
  content_location SMALLINT NOT NULL DEFAULT 0, -- 0=Onchain, 1=External, 2=HTTP
  view_count      BIGINT NOT NULL DEFAULT 0,
  last_chapter_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  block_number    BIGINT NOT NULL
);

CREATE INDEX idx_novels_active ON novels(active);
CREATE INDEX idx_novels_pool ON novels(pool_balance DESC);
CREATE INDEX idx_novels_created ON novels(created_at DESC);

-- ============================================================
-- CHAPTERS
-- ============================================================

CREATE TABLE chapters (
  id              BIGINT PRIMARY KEY,
  novel_id        BIGINT NOT NULL REFERENCES novels(id),
  parent_id       BIGINT NOT NULL DEFAULT 0,
  author          TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  declared_length BIGINT NOT NULL DEFAULT 0,
  depth           INT NOT NULL DEFAULT 1,
  "timestamp"     BIGINT NOT NULL DEFAULT 0,
  is_world_line   BOOLEAN NOT NULL DEFAULT FALSE,
  content_text    TEXT,
  content_fetched BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  block_number    BIGINT NOT NULL
);

CREATE INDEX idx_chapters_novel_id ON chapters(novel_id);
CREATE INDEX idx_chapters_parent_id ON chapters(parent_id);
CREATE INDEX idx_chapters_author ON chapters(author);
CREATE INDEX idx_chapters_world_line ON chapters(novel_id) WHERE is_world_line = TRUE;

-- ============================================================
-- VOTES
-- ============================================================

CREATE TABLE votes (
  id              SERIAL PRIMARY KEY,
  novel_id        BIGINT NOT NULL,
  round           INT NOT NULL,
  voter           TEXT NOT NULL,
  revealed        BOOLEAN NOT NULL DEFAULT FALSE,
  candidate_id    BIGINT,
  claimed         BOOLEAN NOT NULL DEFAULT FALSE,
  commit_block    BIGINT,
  reveal_block    BIGINT
);

CREATE UNIQUE INDEX idx_votes_unique_commit ON votes(novel_id, round, voter);
CREATE INDEX idx_votes_voter ON votes(voter);

-- ============================================================
-- ROUND CANDIDATES (populated on RoundStarted event)
-- ============================================================
CREATE TABLE round_candidates (
  novel_id        BIGINT NOT NULL,
  round           INT NOT NULL,
  chapter_id      BIGINT NOT NULL,
  position        INT NOT NULL,              -- insertion order (keeper leaves, then nominations)
  nominator       TEXT,                      -- NULL = keeper-supplied leaf; lowercase address = user nomination
  block_number    BIGINT NOT NULL,
  PRIMARY KEY (novel_id, round, chapter_id)
);

CREATE INDEX idx_round_candidates_lookup ON round_candidates(novel_id, round);

-- ============================================================
-- ROUND REWARDS (per-round distribution breakdown from PrizePool.RoundRewardsDistributed)
-- ============================================================

CREATE TABLE round_rewards (
  novel_id         BIGINT NOT NULL,
  round            INT NOT NULL,
  creator_royalty  NUMERIC NOT NULL DEFAULT 0,
  author_rewards   NUMERIC NOT NULL DEFAULT 0,
  voter_rewards    NUMERIC NOT NULL DEFAULT 0,
  total_voter_pool NUMERIC NOT NULL DEFAULT 0,  -- filled by VotingEngine.VoterRewardsSettled
  ranked_candidates BIGINT[] NOT NULL DEFAULT '{}', -- from VotingEngine.VotesTallied (ordered)
  block_number     BIGINT NOT NULL,
  PRIMARY KEY (novel_id, round)
);

CREATE INDEX idx_round_rewards_novel ON round_rewards(novel_id);

-- ============================================================
-- KEEPER REWARDS (per-call keeper reward paid from PrizePool.KeeperRewardPaid)
-- ============================================================

CREATE TABLE keeper_rewards (
  id            SERIAL PRIMARY KEY,
  novel_id      BIGINT NOT NULL,
  keeper        TEXT NOT NULL,
  amount        NUMERIC NOT NULL,
  block_number  BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_keeper_rewards_novel ON keeper_rewards(novel_id);
CREATE INDEX idx_keeper_rewards_keeper ON keeper_rewards(keeper);

-- ============================================================
-- TIPS (novel-level)
-- ============================================================

CREATE TABLE tips (
  id              SERIAL PRIMARY KEY,
  novel_id        BIGINT NOT NULL REFERENCES novels(id),
  tipper          TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  block_number    BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tips_novel_id ON tips(novel_id);

-- ============================================================
-- CHAPTER TIPS
-- ============================================================

CREATE TABLE chapter_tips (
  id              SERIAL PRIMARY KEY,
  chapter_id      BIGINT NOT NULL,
  novel_id        BIGINT NOT NULL,
  tipper          TEXT NOT NULL,
  author          TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  block_number    BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chapter_tips_chapter ON chapter_tips(chapter_id);
CREATE INDEX idx_chapter_tips_novel ON chapter_tips(novel_id);

-- ============================================================
-- BOUNTIES
-- ============================================================

CREATE TABLE bounties (
  id                    BIGINT PRIMARY KEY,
  chapter_id            BIGINT NOT NULL,
  novel_id              BIGINT NOT NULL,
  tipper                TEXT NOT NULL,
  locked_amount         NUMERIC NOT NULL,
  create_time           BIGINT NOT NULL,
  deadline              BIGINT NOT NULL,
  designated_chapter_id BIGINT DEFAULT 0,
  claimed               BOOLEAN NOT NULL DEFAULT FALSE, -- true once first claim / full refund recorded
  claimed_amount        NUMERIC NOT NULL DEFAULT 0,     -- total amount claimed out so far
  refunded_amount       NUMERIC NOT NULL DEFAULT 0,     -- amount refunded (tipper or sweep)
  block_number          BIGINT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bounties_chapter ON bounties(chapter_id);
CREATE INDEX idx_bounties_novel ON bounties(novel_id);

-- ============================================================
-- BOUNTY CLAIMS (individual claim rows from BountyBoard.BountyClaimed — author + amount)
-- ============================================================

CREATE TABLE bounty_claims (
  id            SERIAL PRIMARY KEY,
  bounty_id     BIGINT NOT NULL REFERENCES bounties(id),
  author        TEXT NOT NULL,
  amount        NUMERIC NOT NULL,
  block_number  BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bounty_claims_bounty ON bounty_claims(bounty_id);
CREATE INDEX idx_bounty_claims_author ON bounty_claims(author);

-- ============================================================
-- REWARD CLAIMS
-- ============================================================

CREATE TABLE reward_claims (
  id              SERIAL PRIMARY KEY,
  novel_id        BIGINT NOT NULL,
  claimant        TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  source          TEXT NOT NULL,       -- 'prize_pool' or 'voting'
  round           INT,
  block_number    BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reward_claims_claimant ON reward_claims(claimant);
CREATE INDEX idx_reward_claims_novel ON reward_claims(novel_id);

-- ============================================================
-- COMMENTS (off-chain, EIP-191 signed, append-only)
-- ============================================================

CREATE TABLE comments (
  id              SERIAL PRIMARY KEY,
  chapter_id      BIGINT NOT NULL,
  author          TEXT NOT NULL,
  content         TEXT NOT NULL,
  signature       TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_chapter ON comments(chapter_id, created_at DESC);
CREATE INDEX idx_comments_author ON comments(author);

-- ============================================================
-- PENDING VOTES (keeper-assisted reveal: encrypted plaintext votes)
-- ============================================================

CREATE TABLE pending_votes (
  novel_id        BIGINT NOT NULL,
  round           INT NOT NULL,
  voter           TEXT NOT NULL,    -- always stored lowercase
  candidate_id    BIGINT NOT NULL,
  salt_encrypted  TEXT NOT NULL,    -- AES-GCM(VOTE_ENCRYPTION_KEY) of the salt hex
  status          TEXT NOT NULL DEFAULT 'committed', -- committed | revealed | failed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (novel_id, round, voter)
);

CREATE INDEX idx_pending_votes_status ON pending_votes(novel_id, round, status);

-- ============================================================
-- RULES
-- ============================================================

CREATE TABLE rules (
  novel_id        BIGINT NOT NULL,
  name            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  block_number    BIGINT NOT NULL,
  PRIMARY KEY (novel_id, name)
);

CREATE TABLE rule_proposals (
  id              BIGINT PRIMARY KEY,
  novel_id        BIGINT NOT NULL,
  proposer        TEXT NOT NULL,
  proposal_type   SMALLINT NOT NULL,   -- 0=Add, 1=Delete
  rule_name       TEXT NOT NULL,
  rule_content    TEXT NOT NULL DEFAULT '',
  created_at      BIGINT NOT NULL DEFAULT 0,  -- chain timestamp (unix seconds)
  vote_count      INT NOT NULL DEFAULT 0,
  executed        BOOLEAN NOT NULL DEFAULT FALSE,
  block_number    BIGINT NOT NULL
);

CREATE INDEX idx_rule_proposals_novel ON rule_proposals(novel_id);

CREATE TABLE rule_proposal_votes (
  proposal_id     BIGINT NOT NULL REFERENCES rule_proposals(id),
  voter           TEXT NOT NULL,
  block_number    BIGINT NOT NULL,
  PRIMARY KEY (proposal_id, voter)
);

-- ============================================================
-- NICKNAMES
-- ============================================================

CREATE TABLE nicknames (
  address         TEXT PRIMARY KEY,
  nickname        TEXT NOT NULL,
  block_number    BIGINT NOT NULL
);

-- ============================================================
-- INDEXER STATE
-- ============================================================

CREATE TABLE indexer_state (
  id                   INT PRIMARY KEY DEFAULT 1,
  last_block           BIGINT NOT NULL DEFAULT 0,
  last_block_hash      TEXT,
  last_confirmed_block BIGINT NOT NULL DEFAULT 0,
  batch_size           INT NOT NULL DEFAULT 500,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO indexer_state (id, last_block) VALUES (1, 0) ON CONFLICT DO NOTHING;

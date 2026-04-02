-- Initial schema for Onchain Novel web backend

CREATE TABLE IF NOT EXISTS novels (
  id              BIGINT PRIMARY KEY,
  creator         TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  cover_uri       TEXT NOT NULL DEFAULT '',
  config          JSONB NOT NULL,
  current_round   INT NOT NULL DEFAULT 1,
  current_epoch   INT NOT NULL DEFAULT 1,
  round_phase     SMALLINT NOT NULL DEFAULT 0,
  epoch_phase     SMALLINT NOT NULL DEFAULT 0,
  phase_start_time BIGINT NOT NULL DEFAULT 0,
  genesis_chapter_count INT NOT NULL DEFAULT 0,
  cumulative_canon_chapters INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  fork_source_novel_id   BIGINT,
  fork_source_chapter_id BIGINT,
  pool_balance    NUMERIC NOT NULL DEFAULT 0,
  total_tipped    NUMERIC NOT NULL DEFAULT 0,
  total_funded    NUMERIC NOT NULL DEFAULT 0,
  view_count      BIGINT NOT NULL DEFAULT 0,
  last_chapter_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  block_number    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id              BIGINT PRIMARY KEY,
  novel_id        BIGINT NOT NULL REFERENCES novels(id),
  parent_id       BIGINT NOT NULL DEFAULT 0,
  author          TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  declared_length BIGINT NOT NULL DEFAULT 0,
  round           INT NOT NULL DEFAULT 0,
  epoch           INT NOT NULL DEFAULT 0,
  chapter_index   INT NOT NULL DEFAULT 0,
  vote_count      NUMERIC NOT NULL DEFAULT 0,
  is_world_line   BOOLEAN NOT NULL DEFAULT FALSE,
  is_canon        BOOLEAN NOT NULL DEFAULT FALSE,
  content_text    TEXT,
  content_fetched BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  block_number    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tips (
  id              SERIAL PRIMARY KEY,
  novel_id        BIGINT NOT NULL REFERENCES novels(id),
  tipper          TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  tx_hash         TEXT,
  block_timestamp BIGINT,
  block_number    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  id              SERIAL PRIMARY KEY,
  novel_id        BIGINT NOT NULL,
  voting_round_id TEXT NOT NULL,
  voter           TEXT NOT NULL,
  stake_amount    NUMERIC,
  revealed        BOOLEAN NOT NULL DEFAULT FALSE,
  candidate_id    BIGINT,
  claimed         BOOLEAN NOT NULL DEFAULT FALSE,
  commit_block    BIGINT,
  reveal_block    BIGINT
);

CREATE TABLE IF NOT EXISTS reports (
  id              BIGINT PRIMARY KEY,
  novel_id        BIGINT NOT NULL,
  chapter_id      BIGINT NOT NULL,
  reporter        TEXT NOT NULL,
  evidence_hash   TEXT NOT NULL,
  bond_amount     NUMERIC NOT NULL,
  resolved        BOOLEAN NOT NULL DEFAULT FALSE,
  upheld          BOOLEAN,
  block_number    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapter_nfts (
  token_id        BIGINT PRIMARY KEY,
  novel_id        BIGINT NOT NULL,
  chapter_id      BIGINT NOT NULL,
  author          TEXT NOT NULL,
  epoch           INT NOT NULL,
  block_number    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id              SERIAL PRIMARY KEY,
  chapter_id      BIGINT NOT NULL,
  author_address  TEXT,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  deleted         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS indexer_state (
  id              INT PRIMARY KEY DEFAULT 1,
  last_block      BIGINT NOT NULL DEFAULT 0,
  last_block_hash TEXT,
  last_finalized  BIGINT DEFAULT 0,
  batch_size      INT NOT NULL DEFAULT 500,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chapters_novel_id ON chapters(novel_id);
CREATE INDEX IF NOT EXISTS idx_chapters_parent_id ON chapters(parent_id);
CREATE INDEX IF NOT EXISTS idx_chapters_author ON chapters(author);
CREATE INDEX IF NOT EXISTS idx_chapters_is_canon ON chapters(novel_id, is_canon) WHERE is_canon = TRUE;
CREATE INDEX IF NOT EXISTS idx_chapters_round ON chapters(novel_id, round);
CREATE INDEX IF NOT EXISTS idx_tips_novel_id ON tips(novel_id);
CREATE INDEX IF NOT EXISTS idx_votes_novel_voter ON votes(novel_id, voter);
CREATE INDEX IF NOT EXISTS idx_novels_active ON novels(active);
CREATE INDEX IF NOT EXISTS idx_novels_pool ON novels(pool_balance DESC);
CREATE INDEX IF NOT EXISTS idx_novels_view_count ON novels(view_count DESC);
CREATE INDEX IF NOT EXISTS idx_comments_chapter ON comments(chapter_id) WHERE deleted = FALSE;

-- Seed indexer state
INSERT INTO indexer_state (id, last_block) VALUES (1, 0) ON CONFLICT DO NOTHING;

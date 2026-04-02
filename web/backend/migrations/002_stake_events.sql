-- Stake and reward event tracking for user dashboard

CREATE TABLE IF NOT EXISTS stake_events (
  id              SERIAL PRIMARY KEY,
  novel_id        BIGINT NOT NULL,
  author          TEXT NOT NULL,
  event_type      TEXT NOT NULL,  -- 'refunded' | 'slashed'
  amount          NUMERIC NOT NULL,
  block_number    BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reward_claims (
  id              SERIAL PRIMARY KEY,
  novel_id        BIGINT NOT NULL,
  claimant        TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  source          TEXT NOT NULL,  -- 'prize_pool' | 'voting'
  voting_round_id TEXT,
  block_number    BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stake_events_author ON stake_events(author);
CREATE INDEX IF NOT EXISTS idx_stake_events_novel ON stake_events(novel_id);
CREATE INDEX IF NOT EXISTS idx_reward_claims_claimant ON reward_claims(claimant);
CREATE INDEX IF NOT EXISTS idx_reward_claims_novel ON reward_claims(novel_id);

import dotenv from "dotenv";

import { bootstrapConfig } from "@onchain-novel/shared";

// Secrets + DATABASE_URL still flow via env (dotenv stays). Non-secret fields
// (addresses, URLs, ports, indexer params) come from config.yaml.
dotenv.config();

// Single startup bootstrap: load config.yaml, auto-detect chainId via RPC if
// absent, walk NovelCore's address book to resolve every other contract.
// Top-level await so every module that imports `env` sees a fully populated
// object — there is no "before init" state to worry about.
const { config: cfg, chainId, contracts } = await bootstrapConfig();

export const env = {
  DATABASE_URL: cfg.backend.databaseUrl,
  RPC_URL: cfg.chain.rpcUrl,
  RPC_FALLBACK_URLS: (process.env.RPC_FALLBACK_URLS || "").split(",").filter(Boolean),
  CHAIN_ID: chainId,
  NOVEL_CORE_ADDRESS: contracts.novelCore,
  ROUND_MANAGER_ADDRESS: contracts.roundManager,
  VOTING_ENGINE_ADDRESS: contracts.votingEngine,
  PRIZE_POOL_ADDRESS: contracts.prizePool,
  BOUNTY_BOARD_ADDRESS: contracts.bountyBoard,
  RULES_ENGINE_ADDRESS: contracts.rulesEngine,
  USER_REGISTRY_ADDRESS: contracts.userRegistry,
  INDEXER_START_BLOCK: BigInt(cfg.backend.indexer.startBlock),
  INDEXER_POLL_INTERVAL_MS: cfg.backend.indexer.pollIntervalMs,
  INDEXER_CONFIRMATION_BLOCKS: cfg.backend.indexer.confirmationBlocks,
  INDEXER_BATCH_SIZE: cfg.backend.indexer.batchSize,
  PORT: cfg.backend.port,
  HOST: cfg.backend.host,
  KEEPER_PRIVATE_KEY: (process.env.KEEPER_PRIVATE_KEY || "") as `0x${string}`,
  KEEPER_POLL_INTERVAL_MS: cfg.backend.keeper.pollIntervalMs,
  // 32-byte key (hex or base64) to encrypt stored plaintext votes. Required
  // only when accepting POST /api/votes/submit. Env-only for secrecy.
  VOTE_ENCRYPTION_KEY: process.env.VOTE_ENCRYPTION_KEY || "",
  // Allowed CORS origins (split-deploy / native-app clients). Same-origin
  // browsers don't need this because the Next.js proxy keeps API calls local.
  FRONTEND_URLS: (process.env.FRONTEND_URL || "").split(",").map((s) => s.trim()).filter(Boolean),
};

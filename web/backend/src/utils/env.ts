import dotenv from "dotenv";
import { loadConfig } from "@onchain-novel/shared";

// Secrets + DATABASE_URL still flow via env (dotenv stays). Non-secret fields
// (addresses, URLs, ports, indexer params) come from config.yaml.
dotenv.config();

const cfg = loadConfig();

function requireAddress(name: keyof typeof cfg.contracts): `0x${string}` {
  const v = cfg.contracts[name];
  if (!v) throw new Error(`Missing contract address in config.yaml: contracts.${name}`);
  return v;
}

export const env = {
  DATABASE_URL: cfg.backend.databaseUrl,
  RPC_URL: cfg.chain.rpcUrl,
  RPC_FALLBACK_URLS: (process.env.RPC_FALLBACK_URLS || "").split(",").filter(Boolean),
  NOVEL_CORE_ADDRESS: requireAddress("novelCore"),
  ROUND_MANAGER_ADDRESS: (cfg.contracts.roundManager ?? "") as `0x${string}`,
  VOTING_ENGINE_ADDRESS: (cfg.contracts.votingEngine ?? "") as `0x${string}`,
  PRIZE_POOL_ADDRESS: (cfg.contracts.prizePool ?? "") as `0x${string}`,
  BOUNTY_BOARD_ADDRESS: (cfg.contracts.bountyBoard ?? "") as `0x${string}`,
  RULES_ENGINE_ADDRESS: (cfg.contracts.rulesEngine ?? "") as `0x${string}`,
  USER_REGISTRY_ADDRESS: (cfg.contracts.userRegistry ?? "") as `0x${string}`,
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

import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  RPC_URL: required("RPC_URL"),
  RPC_FALLBACK_URLS: optional("RPC_FALLBACK_URLS", "").split(",").filter(Boolean),
  NOVEL_CORE_ADDRESS: required("NOVEL_CORE_ADDRESS") as `0x${string}`,
  ROUND_MANAGER_ADDRESS: optional("ROUND_MANAGER_ADDRESS", "") as `0x${string}`,
  VOTING_ENGINE_ADDRESS: optional("VOTING_ENGINE_ADDRESS", "") as `0x${string}`,
  PRIZE_POOL_ADDRESS: optional("PRIZE_POOL_ADDRESS", "") as `0x${string}`,
  BOUNTY_BOARD_ADDRESS: optional("BOUNTY_BOARD_ADDRESS", "") as `0x${string}`,
  RULES_ENGINE_ADDRESS: optional("RULES_ENGINE_ADDRESS", "") as `0x${string}`,
  USER_REGISTRY_ADDRESS: optional("USER_REGISTRY_ADDRESS", "") as `0x${string}`,
  INDEXER_START_BLOCK: BigInt(optional("INDEXER_START_BLOCK", "0")),
  INDEXER_POLL_INTERVAL_MS: parseInt(optional("INDEXER_POLL_INTERVAL_MS", "5000")),
  INDEXER_CONFIRMATION_BLOCKS: parseInt(optional("INDEXER_CONFIRMATION_BLOCKS", "12")),
  PORT: parseInt(optional("PORT", "3001")),
  KEEPER_PRIVATE_KEY: optional("KEEPER_PRIVATE_KEY", "") as `0x${string}`,
  KEEPER_POLL_INTERVAL_MS: parseInt(optional("KEEPER_POLL_INTERVAL_MS", "10000")),
  // 32-byte key (hex or base64) used to encrypt stored plaintext votes for keeper-assisted reveal.
  // Required only when accepting POST /api/votes/submit.
  VOTE_ENCRYPTION_KEY: optional("VOTE_ENCRYPTION_KEY", ""),
};

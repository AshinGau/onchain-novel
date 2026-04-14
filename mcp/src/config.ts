import type { Address, Hex } from "viem";

export interface McpConfig {
  rpcUrl: string;
  chainId: number;
  privateKey: Hex;
  novelCore: Address;
  roundManager: Address;
  prizePool: Address;
  bountyBoard: Address;
  rulesEngine: Address;
  userRegistry: Address;
  apiBaseUrl: string;
}

export const config: McpConfig = {
  rpcUrl: process.env.RPC_URL || "http://localhost:8545",
  chainId: parseInt(process.env.CHAIN_ID || "31337"),
  privateKey: (process.env.PRIVATE_KEY || "") as Hex,
  novelCore: (process.env.NOVEL_CORE_ADDRESS || "") as Address,
  roundManager: (process.env.ROUND_MANAGER_ADDRESS || "") as Address,
  prizePool: (process.env.PRIZE_POOL_ADDRESS || "") as Address,
  bountyBoard: (process.env.BOUNTY_BOARD_ADDRESS || "") as Address,
  rulesEngine: (process.env.RULES_ENGINE_ADDRESS || "") as Address,
  userRegistry: (process.env.USER_REGISTRY_ADDRESS || "") as Address,
  apiBaseUrl: process.env.API_BASE_URL || "",
};

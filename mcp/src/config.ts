import type { Address, Hex } from "viem";

export interface McpConfig {
  rpcUrl: string;
  chainId: number;
  privateKey: Hex;
  novelCore: Address;
  bountyBoard: Address;
  rulesEngine: Address;
  apiBaseUrl: string;
}

export const config: McpConfig = {
  rpcUrl: process.env.RPC_URL || "http://localhost:8545",
  chainId: parseInt(process.env.CHAIN_ID || "31337"),
  privateKey: (process.env.PRIVATE_KEY || "") as Hex,
  novelCore: (process.env.NOVEL_CORE_ADDRESS || "") as Address,
  bountyBoard: (process.env.BOUNTY_BOARD_ADDRESS || "") as Address,
  rulesEngine: (process.env.RULES_ENGINE_ADDRESS || "") as Address,
  apiBaseUrl: process.env.API_BASE_URL || "",
};

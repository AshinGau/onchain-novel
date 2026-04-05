import { type Address, type Hex } from "viem";

export const config = {
  rpcUrl: process.env.RPC_URL || "http://localhost:8545",
  novelCoreAddress: (process.env.NOVEL_CORE_ADDRESS || "") as Address,
  votingEngineAddress: (process.env.VOTING_ENGINE_ADDRESS || "") as Address,
  prizePoolAddress: (process.env.PRIZE_POOL_ADDRESS || "") as Address,
  chapterNFTAddress: (process.env.CHAPTER_NFT_ADDRESS || "") as Address,
  privateKey: (process.env.PRIVATE_KEY || "") as Hex,
  /** Optional Web API base URL (e.g. "http://localhost:3001"). When set, read tools use the API instead of RPC. */
  apiBaseUrl: process.env.API_BASE_URL || "",
};

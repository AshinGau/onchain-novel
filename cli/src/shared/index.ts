// Thin barrel re-export so command files import chain helpers via the
// shorter relative path "../shared/index.js".
export * from "@onchain-novel/shared/chain";

/**
 * Resolved CLI runtime config. After bootstrap, every contract address is
 * present (the rest of the deployment is derived on-chain from novelCore via
 * resolveContracts). Sync surface for command code; the async work happens
 * once at startup in the bin's preAction hook.
 */
export interface OnchainNovelConfig {
  rpcUrl: string;
  chainId: number;
  apiUrl: string;
  contracts: {
    novelCore: `0x${string}`;
    roundManager: `0x${string}`;
    votingEngine: `0x${string}`;
    prizePool: `0x${string}`;
    bountyBoard: `0x${string}`;
    rulesEngine: `0x${string}`;
    userRegistry: `0x${string}`;
  };
}

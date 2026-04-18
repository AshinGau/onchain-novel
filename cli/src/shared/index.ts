// Thin compat barrel — re-exports everything from @onchain-novel/shared/chain
// so existing `from "../shared/index.js"` imports keep working. Keeps the
// command files' import paths stable after the package consolidation.
export * from "@onchain-novel/shared/chain";

/**
 * Legacy config shape used by a few commands. New code should pull types from
 * @onchain-novel/shared/api instead. Left here so nothing breaks during the
 * migration; ok to delete once the commands are rewritten to use the shared
 * AppConfig directly.
 */
export interface OnchainNovelConfig {
  rpcUrl: string;
  chainId?: number;
  apiUrl?: string;
  contracts: {
    novelCore: `0x${string}`;
    roundManager: `0x${string}`;
    prizePool: `0x${string}`;
    bountyBoard?: `0x${string}`;
    rulesEngine?: `0x${string}`;
    userRegistry?: `0x${string}`;
  };
}

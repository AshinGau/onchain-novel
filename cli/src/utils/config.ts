import { loadConfig as loadAppConfig, getPrivateKey as getPkFromEnv } from "@onchain-novel/shared";
import type { OnchainNovelConfig } from "../shared/index.js";

/**
 * CLI config is read from the shared project config.yaml. Run the CLI from
 * inside the repo (or set ONCHAIN_NOVEL_CONFIG=/path/to/config.yaml) and the
 * loader walks up to the nearest config.yaml.
 *
 * Private keys are NEVER persisted — export PRIVATE_KEY in your shell.
 */
export function requireConfig(): OnchainNovelConfig {
  const cfg = loadAppConfig();
  if (!cfg.contracts.novelCore) {
    console.error(
      "Missing contracts.novelCore in config.yaml. Deploy contracts first (scripts/Deploy.s.sol) — the patch-config tool will fill the addresses in.",
    );
    return process.exit(1);
  }
  return {
    rpcUrl: cfg.chain.rpcUrl,
    chainId: cfg.chain.chainId,
    apiUrl: cfg.cli.apiUrl,
    contracts: {
      novelCore: cfg.contracts.novelCore,
      roundManager: cfg.contracts.roundManager ?? ("0x" as `0x${string}`),
      prizePool: cfg.contracts.prizePool ?? ("0x" as `0x${string}`),
      bountyBoard: cfg.contracts.bountyBoard,
      rulesEngine: cfg.contracts.rulesEngine,
      userRegistry: cfg.contracts.userRegistry,
    },
  };
}

export function getPrivateKey(): `0x${string}` | null {
  return getPkFromEnv();
}

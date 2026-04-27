import {
  bootstrapConfig,
  getPrivateKey as getPkFromEnv,
  type BootstrappedConfig,
} from "@onchain-novel/shared";

import type { OnchainNovelConfig } from "../shared/index.js";

/**
 * CLI config flow:
 *
 *   1. The bin entry installs a commander preAction hook that calls
 *      `ensureBootstrapped()` for any command needing chain access.
 *   2. Bootstrap loads config.yaml + walks NovelCore's on-chain address book
 *      to resolve every other contract (and auto-detects chainId if absent).
 *   3. Commands then call `requireConfig()` synchronously and get the resolved
 *      shape. Read-only commands like `setup`/`guide` skip the hook entirely
 *      — they don't need an RPC.
 *
 * Private keys are NEVER persisted — export PRIVATE_KEY in your shell.
 */
let _cache: BootstrappedConfig | null = null;

export async function ensureBootstrapped(): Promise<void> {
  if (_cache) return;
  try {
    _cache = await bootstrapConfig();
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }
}

export function requireConfig(): OnchainNovelConfig {
  if (!_cache) {
    console.error(
      "CLI bootstrap was not called for this command. This is a bug — please file an issue.",
    );
    process.exit(1);
  }
  const { config, chainId, contracts } = _cache;
  return {
    rpcUrl: config.chain.rpcUrl,
    chainId,
    apiUrl: config.cli.apiUrl,
    contracts,
  };
}

export function getPrivateKey(): `0x${string}` | null {
  return getPkFromEnv();
}

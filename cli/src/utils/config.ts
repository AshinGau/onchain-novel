import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { OnchainNovelConfig } from "../shared/index.js";

const CONFIG_DIR = join(homedir(), ".onchain-novel");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Load config from disk. Strips any legacy `privateKey` field that may still be
 * present from older CLI versions — secrets must come from the PRIVATE_KEY env
 * var, never from disk.
 */
export function loadConfig(): OnchainNovelConfig | null {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as OnchainNovelConfig & { privateKey?: string };
    if (parsed.privateKey !== undefined) {
      delete parsed.privateKey;
      saveConfig(parsed);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveConfig(config: OnchainNovelConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // best effort; non-POSIX filesystems may not support
  }
}

/** Read signer private key from environment. CLI never persists secrets. */
export function getPrivateKey(): `0x${string}` | null {
  const pk = process.env.PRIVATE_KEY?.trim();
  if (!pk) return null;
  return (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
}

export function requireConfig(): OnchainNovelConfig {
  const config = loadConfig();
  if (!config) {
    console.error("No configuration found. Run 'onchain-novel-cli setup' first.");
    return process.exit(1);
  }
  if (!config.rpcUrl) {
    console.error("Missing rpcUrl in config. Run 'onchain-novel-cli config set rpcUrl <url>'.");
    return process.exit(1);
  }
  if (!config.contracts?.novelCore) {
    console.error(
      "Missing contracts.novelCore in config. Run 'onchain-novel-cli config set contracts.novelCore <address>'.",
    );
    return process.exit(1);
  }
  return config;
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { OnchainNovelConfig } from "../shared/index.js";

const CONFIG_DIR = join(homedir(), ".onchain-novel");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function loadConfig(): OnchainNovelConfig | null {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as OnchainNovelConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: OnchainNovelConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
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

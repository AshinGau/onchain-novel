import { Command } from "commander";

import { loadConfig } from "@onchain-novel/shared";
import { error, header, kv } from "../utils/format.js";

export function registerConfigCommand(program: Command): void {
  program
    .command("config")
    .description(
      "Show current configuration. Edit config.yaml (repo root) directly to change values. " +
        "Secrets (PRIVATE_KEY, KEEPER_PRIVATE_KEY, VOTE_ENCRYPTION_KEY) stay in env vars.",
    )
    .action(() => {
      try {
        const cfg = loadConfig();
        header("Configuration");
        kv("chain.rpcUrl", cfg.chain.rpcUrl);
        kv("chain.chainId", cfg.chain.chainId);
        kv("cli.apiUrl", cfg.cli.apiUrl);
        kv("PRIVATE_KEY env", process.env.PRIVATE_KEY ? "(set)" : "(not set)");
        kv("contracts.novelCore", cfg.contracts.novelCore ?? "(not set)");
        kv("contracts.roundManager", cfg.contracts.roundManager ?? "(not set)");
        kv("contracts.prizePool", cfg.contracts.prizePool ?? "(not set)");
        kv("contracts.bountyBoard", cfg.contracts.bountyBoard ?? "(not set)");
        kv("contracts.rulesEngine", cfg.contracts.rulesEngine ?? "(not set)");
        kv("contracts.userRegistry", cfg.contracts.userRegistry ?? "(not set)");
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}

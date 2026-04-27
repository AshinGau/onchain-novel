import { Command } from "commander";

import { bootstrapConfig } from "@onchain-novel/shared";
import { error, header, kv } from "../utils/format.js";

export function registerConfigCommand(program: Command): void {
  program
    .command("config")
    .description(
      "Show current configuration. Edit config.yaml (repo root) directly to change values. " +
        "Secrets (PRIVATE_KEY, KEEPER_PRIVATE_KEY, VOTE_ENCRYPTION_KEY) stay in env vars.",
    )
    .action(async () => {
      try {
        const { config, chainId, contracts } = await bootstrapConfig();
        header("Configuration");
        kv("chain.rpcUrl", config.chain.rpcUrl);
        kv("chain.chainId", chainId);
        kv("cli.apiUrl", config.cli.apiUrl);
        kv("PRIVATE_KEY env", process.env.PRIVATE_KEY ? "(set)" : "(not set)");
        kv("contracts.novelCore", contracts.novelCore);
        kv("contracts.roundManager", contracts.roundManager);
        kv("contracts.votingEngine", contracts.votingEngine);
        kv("contracts.prizePool", contracts.prizePool);
        kv("contracts.bountyBoard", contracts.bountyBoard);
        kv("contracts.rulesEngine", contracts.rulesEngine);
        kv("contracts.userRegistry", contracts.userRegistry);
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}

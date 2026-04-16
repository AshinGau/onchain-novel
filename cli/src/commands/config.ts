import { Command } from "commander";

import type { OnchainNovelConfig } from "../shared/index.js";
import { getConfigPath, loadConfig, saveConfig } from "../utils/config.js";
import { error, header, kv, success } from "../utils/format.js";

export function registerConfigCommand(program: Command): void {
  const config = program.command("config").description("View or modify CLI configuration");

  // Show current config
  config.action(() => {
    const cfg = loadConfig();
    if (!cfg) {
      console.log("No configuration found. Run 'onchain-novel-cli setup' first.");
      return;
    }
    header("Configuration");
    kv("Path", getConfigPath());
    kv("rpcUrl", cfg.rpcUrl);
    kv("chainId", cfg.chainId ?? 31337);
    kv("PRIVATE_KEY env", process.env.PRIVATE_KEY ? "(set)" : "(not set)");
    kv("apiUrl", cfg.apiUrl ?? "(not set)");
    kv("contracts.novelCore", cfg.contracts?.novelCore ?? "(not set)");
    kv("contracts.roundManager", cfg.contracts?.roundManager ?? "(not set)");
    kv("contracts.prizePool", cfg.contracts?.prizePool ?? "(not set)");
    kv("contracts.bountyBoard", cfg.contracts?.bountyBoard ?? "(not set)");
    kv("contracts.rulesEngine", cfg.contracts?.rulesEngine ?? "(not set)");
    kv("contracts.userRegistry", cfg.contracts?.userRegistry ?? "(not set)");
    console.log();
  });

  // Set a config value
  config
    .command("set <key> <value>")
    .description("Set a configuration value (e.g., rpcUrl, contracts.novelCore). Note: secrets are NOT stored in config — export PRIVATE_KEY in your shell instead.")
    .action((key: string, value: string) => {
      if (key === "privateKey") {
        error(
          "privateKey is no longer stored in config. Export it in your shell:\n" +
            "  export PRIVATE_KEY=0x...",
        );
        process.exit(1);
      }

      const cfg = loadConfig() ?? {
        rpcUrl: "",
        contracts: {
          novelCore: "0x" as `0x${string}`,
          roundManager: "0x" as `0x${string}`,
          prizePool: "0x" as `0x${string}`,
        },
      };

      if (key.startsWith("contracts.")) {
        const contractKey = key.split(".")[1] as keyof OnchainNovelConfig["contracts"];
        if (!cfg.contracts) {
          (cfg as OnchainNovelConfig).contracts = {
            novelCore: "0x" as `0x${string}`,
            roundManager: "0x" as `0x${string}`,
            prizePool: "0x" as `0x${string}`,
          };
        }
        (cfg.contracts as Record<string, string>)[contractKey] = value;
      } else if (key === "chainId") {
        (cfg as unknown as Record<string, unknown>)[key] = parseInt(value);
      } else if (key === "rpcUrl" || key === "apiUrl") {
        (cfg as unknown as Record<string, unknown>)[key] = value;
      } else {
        error(`Unknown config key: ${key}`);
        console.log(
          "Valid keys: rpcUrl, chainId, apiUrl, contracts.novelCore, contracts.roundManager, contracts.prizePool, contracts.bountyBoard, contracts.rulesEngine, contracts.userRegistry",
        );
        process.exit(1);
      }

      saveConfig(cfg as OnchainNovelConfig);
      success(`Set ${key} = ${value}`);
    });
}

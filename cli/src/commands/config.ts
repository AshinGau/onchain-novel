import { Command } from "commander";
import { loadConfig, saveConfig, getConfigPath } from "../utils/config.js";
import { header, kv, success, error } from "../utils/format.js";
import type { OnchainNovelConfig } from "../shared/index.js";

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("View or modify CLI configuration");

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
    kv("privateKey", cfg.privateKey ? cfg.privateKey.slice(0, 10) + "..." : "(not set)");
    kv("apiUrl", cfg.apiUrl ?? "(not set)");
    kv("contracts.novelCore", cfg.contracts?.novelCore ?? "(not set)");
    kv("contracts.votingEngine", cfg.contracts?.votingEngine ?? "(not set)");
    kv("contracts.prizePool", cfg.contracts?.prizePool ?? "(not set)");
    kv("contracts.bountyBoard", cfg.contracts?.bountyBoard ?? "(not set)");
    kv("contracts.rulesEngine", cfg.contracts?.rulesEngine ?? "(not set)");
    console.log();
  });

  // Set a config value
  config
    .command("set <key> <value>")
    .description("Set a configuration value (e.g., rpcUrl, privateKey, contracts.novelCore)")
    .action((key: string, value: string) => {
      const cfg = loadConfig() ?? {
        rpcUrl: "",
        contracts: { novelCore: "0x" as `0x${string}` },
      };

      if (key.startsWith("contracts.")) {
        const contractKey = key.split(".")[1] as keyof OnchainNovelConfig["contracts"];
        if (!cfg.contracts) {
          (cfg as OnchainNovelConfig).contracts = { novelCore: "0x" as `0x${string}` };
        }
        (cfg.contracts as Record<string, string>)[contractKey] = value;
      } else if (key === "chainId") {
        (cfg as unknown as Record<string, unknown>)[key] = parseInt(value);
      } else if (key === "rpcUrl" || key === "privateKey" || key === "apiUrl") {
        (cfg as unknown as Record<string, unknown>)[key] = value;
      } else {
        error(`Unknown config key: ${key}`);
        console.log("Valid keys: rpcUrl, chainId, privateKey, apiUrl, contracts.novelCore, contracts.votingEngine, contracts.prizePool, contracts.bountyBoard, contracts.rulesEngine");
        process.exit(1);
      }

      saveConfig(cfg as OnchainNovelConfig);
      success(`Set ${key} = ${key === "privateKey" ? value.slice(0, 10) + "..." : value}`);
    });
}

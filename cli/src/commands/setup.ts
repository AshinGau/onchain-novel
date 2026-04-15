import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

import type { OnchainNovelConfig } from "../shared/index.js";
import { loadConfig, saveConfig } from "../utils/config.js";
import { error, header, success } from "../utils/format.js";

function prompt(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultVal?: string,
): Promise<string> {
  const suffix = defaultVal ? ` (${defaultVal})` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Interactive setup: configure CLI and generate project files")
    .option("--mcp", "also generate .mcp.json for MCP-capable agents (off by default)")
    .action(async (opts) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });

      try {
        header("Onchain Novel CLI Setup");
        console.log("  This will configure your CLI and generate project files.\n");

        const existing = loadConfig();

        const rpcUrl = await prompt(rl, "  RPC URL", existing?.rpcUrl ?? "http://127.0.0.1:8545");
        const chainIdStr = await prompt(rl, "  Chain ID", String(existing?.chainId ?? "31337"));
        const apiUrl = await prompt(
          rl,
          "  Backend API URL",
          existing?.apiUrl ?? "http://localhost:3001",
        );
        const novelCore = await prompt(
          rl,
          "  NovelCore contract address",
          existing?.contracts?.novelCore ?? "",
        );
        const roundManager = await prompt(
          rl,
          "  RoundManager contract address",
          existing?.contracts?.roundManager ?? "",
        );
        const prizePool = await prompt(
          rl,
          "  PrizePool contract address",
          existing?.contracts?.prizePool ?? "",
        );
        const bountyBoard = await prompt(
          rl,
          "  BountyBoard contract address (optional)",
          existing?.contracts?.bountyBoard ?? "",
        );
        const rulesEngine = await prompt(
          rl,
          "  RulesEngine contract address (optional)",
          existing?.contracts?.rulesEngine ?? "",
        );
        const userRegistry = await prompt(
          rl,
          "  UserRegistry contract address (optional)",
          existing?.contracts?.userRegistry ?? "",
        );

        const chainId = parseInt(chainIdStr) || 31337;
        const config: OnchainNovelConfig = {
          rpcUrl,
          chainId,
          apiUrl,
          contracts: {
            novelCore: novelCore as `0x${string}`,
            roundManager: roundManager as `0x${string}`,
            prizePool: prizePool as `0x${string}`,
            ...(bountyBoard ? { bountyBoard: bountyBoard as `0x${string}` } : {}),
            ...(rulesEngine ? { rulesEngine: rulesEngine as `0x${string}` } : {}),
            ...(userRegistry ? { userRegistry: userRegistry as `0x${string}` } : {}),
          },
        };

        saveConfig(config);
        success("Configuration saved to ~/.onchain-novel/config.json");

        // .mcp.json is opt-in via --mcp. Never embed secrets — the MCP process
        // inherits PRIVATE_KEY from its parent shell (the Claude Code host).
        if (opts.mcp) {
          const mcpConfig = {
            mcpServers: {
              "onchain-novel": {
                command: "onchain-novel-mcp",
                env: {
                  RPC_URL: rpcUrl,
                },
              },
            },
          };
          writeFileSync(
            join(process.cwd(), ".mcp.json"),
            JSON.stringify(mcpConfig, null, 2) + "\n",
          );
          success("Generated .mcp.json (no secrets inside)");
        }

        // Generate .claude/commands/ skill files
        const skillsDir = join(process.cwd(), ".claude", "commands");
        if (!existsSync(skillsDir)) {
          mkdirSync(skillsDir, { recursive: true });
        }

        const guidesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "guides");
        const roles = ["author", "voter", "creator", "reader"] as const;
        for (const role of roles) {
          const guidePath = join(guidesDir, `${role}.md`);
          let content: string;
          try {
            content = readFileSync(guidePath, "utf-8");
          } catch {
            // Fallback if guides not found in dist
            content = `# Novel ${role.charAt(0).toUpperCase() + role.slice(1)} Workflow\n\nRun \`onchain-novel-cli guide ${role}\` for details.\n`;
          }
          writeFileSync(join(skillsDir, `novel-${role}.md`), content);
        }
        success("Generated .claude/commands/novel-{author,voter,creator,reader}.md");

        console.log(
          "\nSetup complete. Run 'onchain-novel-cli --help' to see available commands.\n",
        );
        console.log(
          "  Secrets are never persisted. Export your signer key before running write commands:\n" +
            "    export PRIVATE_KEY=0x...\n" +
            "  (Use direnv, 1Password CLI, or a shell secret manager for convenience.)\n",
        );
      } catch (err) {
        error(String(err));
        process.exit(1);
      } finally {
        rl.close();
      }
    });
}

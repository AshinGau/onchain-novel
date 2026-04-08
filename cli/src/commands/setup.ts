import { Command } from "commander";
import { createInterface } from "node:readline";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { saveConfig, loadConfig } from "../utils/config.js";
import type { OnchainNovelConfig } from "../shared/index.js";
import { success, error, header, kv } from "../utils/format.js";

function prompt(rl: ReturnType<typeof createInterface>, question: string, defaultVal?: string): Promise<string> {
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
    .action(async () => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });

      try {
        header("Onchain Novel CLI Setup");
        console.log("  This will configure your CLI and generate project files.\n");

        const existing = loadConfig();

        const rpcUrl = await prompt(rl, "  RPC URL", existing?.rpcUrl ?? "http://127.0.0.1:8545");
        const chainIdStr = await prompt(rl, "  Chain ID", String(existing?.chainId ?? "31337"));
        const privateKey = await prompt(rl, "  Private key (hex, optional)", existing?.privateKey ?? "");
        const apiUrl = await prompt(rl, "  Backend API URL", existing?.apiUrl ?? "http://localhost:3001");
        const novelCore = await prompt(
          rl,
          "  NovelCore contract address",
          existing?.contracts?.novelCore ?? "",
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

        const chainId = parseInt(chainIdStr) || 31337;
        const config: OnchainNovelConfig = {
          rpcUrl,
          chainId,
          privateKey: privateKey || undefined,
          apiUrl,
          contracts: {
            novelCore: novelCore as `0x${string}`,
            ...(bountyBoard ? { bountyBoard: bountyBoard as `0x${string}` } : {}),
            ...(rulesEngine ? { rulesEngine: rulesEngine as `0x${string}` } : {}),
          },
        };

        saveConfig(config);
        success("Configuration saved to ~/.onchain-novel/config.json");

        // Generate .mcp.json in current directory
        const mcpConfig = {
          mcpServers: {
            "onchain-novel": {
              command: "onchain-novel-mcp",
              env: {
                RPC_URL: rpcUrl,
                ...(privateKey ? { PRIVATE_KEY: privateKey } : {}),
              },
            },
          },
        };
        writeFileSync(join(process.cwd(), ".mcp.json"), JSON.stringify(mcpConfig, null, 2) + "\n");
        success("Generated .mcp.json");

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

        console.log("\nSetup complete. Run 'onchain-novel-cli --help' to see available commands.\n");
      } catch (err) {
        error(String(err));
        process.exit(1);
      } finally {
        rl.close();
      }
    });
}

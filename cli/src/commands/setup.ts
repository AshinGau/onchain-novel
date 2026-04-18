import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

import { error, header, success } from "../utils/format.js";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description(
      "Drop role-specific skill files into .claude/commands/ so Claude Code " +
        "(and similar agents) can pick them up. Configuration lives in the " +
        "repo's config.yaml — scripts/deploy.sh writes contract addresses there.",
    )
    .action(() => {
      try {
        header("Onchain Novel CLI Setup");

        const skillsDir = join(process.cwd(), ".claude", "commands");
        if (!existsSync(skillsDir)) {
          mkdirSync(skillsDir, { recursive: true });
        }

        // Resolve guides relative to this module file. Works in both layouts:
        //   dev tsc: dist/commands/setup.js → "../guides" → dist/guides
        //   prod tsup bundle: dist/onchain-novel-cli.js → "./guides" → dist/guides
        const here = dirname(fileURLToPath(import.meta.url));
        const guidesDir = existsSync(join(here, "guides"))
          ? join(here, "guides")
          : join(here, "..", "guides");
        const roles = ["author", "voter", "creator", "reader"] as const;
        for (const role of roles) {
          const guidePath = join(guidesDir, `${role}.md`);
          let content: string;
          try {
            content = readFileSync(guidePath, "utf-8");
          } catch {
            content = `# Novel ${role.charAt(0).toUpperCase() + role.slice(1)} Workflow\n\nRun \`onchain-novel-cli guide ${role}\` for details.\n`;
          }
          writeFileSync(join(skillsDir, `novel-${role}.md`), content);
        }
        success("Generated .claude/commands/novel-{author,voter,creator,reader}.md");

        console.log(
          "\nNext steps:\n" +
            "  - Ensure config.yaml at the repo root has your contract addresses.\n" +
            "  - export PRIVATE_KEY=0x... before running write commands.\n",
        );
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}

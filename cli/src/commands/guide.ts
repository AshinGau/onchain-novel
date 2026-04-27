import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

import { error } from "../utils/format.js";

function getSkillPath(): string {
  // Resolve relative to this module file. Works in both layouts:
  //   dev tsc:    dist/commands/guide.js → "../guides/SKILL.md"
  //   tsup bundle: dist/onchain-novel-cli.js → "./guides/SKILL.md"
  const here = dirname(fileURLToPath(import.meta.url));
  return existsSync(join(here, "guides"))
    ? join(here, "guides", "SKILL.md")
    : join(here, "..", "guides", "SKILL.md");
}

export function registerGuideCommands(program: Command): void {
  program
    .command("guide")
    .description("Print the agent workflow guide (covers reader / voter / author / creator)")
    .action(() => {
      try {
        console.log(readFileSync(getSkillPath(), "utf-8"));
      } catch (err) {
        error(`Could not load guide. ${String(err)}`);
        process.exit(1);
      }
    });
}

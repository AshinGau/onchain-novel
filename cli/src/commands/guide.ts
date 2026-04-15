import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

import { error } from "../utils/format.js";

const VALID_ROLES = ["author", "voter", "creator", "reader"] as const;
type Role = (typeof VALID_ROLES)[number];

function getGuidePath(role: Role): string {
  const guidesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "guides");
  return join(guidesDir, `${role}.md`);
}

export function registerGuideCommands(program: Command): void {
  program
    .command("guide <role>")
    .description("Show workflow guide (author, voter, creator, reader)")
    .action((role: string) => {
      try {
        if (!VALID_ROLES.includes(role as Role)) {
          error(`Invalid role: ${role}. Choose from: ${VALID_ROLES.join(", ")}`);
          process.exit(1);
        }
        const path = getGuidePath(role as Role);
        const content = readFileSync(path, "utf-8");
        console.log(content);
      } catch (err) {
        error(`Could not load guide for "${role}". ${String(err)}`);
        process.exit(1);
      }
    });
}

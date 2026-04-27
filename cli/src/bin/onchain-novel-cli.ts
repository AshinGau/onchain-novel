#!/usr/bin/env node
import { program } from "commander";

import { registerBountyCommands } from "../commands/bounty.js";
import { registerChapterCommands } from "../commands/chapter.js";
import { registerConfigCommand } from "../commands/config.js";
import { registerGuideCommands } from "../commands/guide.js";
import { registerNovelCommands } from "../commands/novel.js";
import { registerRuleCommands } from "../commands/rule.js";
import { registerSetupCommand } from "../commands/setup.js";
import { registerTipCommands } from "../commands/tip.js";
import { registerUserCommands } from "../commands/user.js";
import { registerVoteCommands } from "../commands/vote.js";
import { ensureBootstrapped } from "../utils/config.js";

program
  .name("onchain-novel-cli")
  .description(
    "Onchain Novel Protocol CLI — create, write, vote, tip, and manage collaborative on-chain novels",
  )
  .version("0.1.0");

// Commands that don't touch the chain. `setup` writes a fresh config.yaml from
// scratch; `guide` only prints embedded markdown; `config` does its own
// bootstrap so it can render even when the chain is unreachable.
const NO_BOOTSTRAP = new Set(["setup", "guide", "config"]);

program.hook("preAction", async (_thisCmd, actionCmd) => {
  // For grouped commands (e.g. `chapter submit`) commander reports the leaf
  // name; the group lives on `actionCmd.parent.name()`.
  const top = actionCmd.parent?.name() === "onchain-novel-cli" ? actionCmd.name() : actionCmd.parent?.name();
  if (top && NO_BOOTSTRAP.has(top)) return;
  await ensureBootstrapped();
});

registerSetupCommand(program);
registerConfigCommand(program);
registerNovelCommands(program);
registerChapterCommands(program);
registerVoteCommands(program);
registerTipCommands(program);
registerBountyCommands(program);
registerRuleCommands(program);
registerUserCommands(program);
registerGuideCommands(program);

program.parseAsync().catch((err) => {
  console.error(String(err));
  process.exit(1);
});

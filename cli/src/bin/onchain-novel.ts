#!/usr/bin/env node
import { program } from "commander";
import { registerNovelCommands } from "../commands/novel.js";
import { registerChapterCommands } from "../commands/chapter.js";
import { registerVoteCommands } from "../commands/vote.js";
import { registerTipCommands } from "../commands/tip.js";
import { registerBountyCommands } from "../commands/bounty.js";
import { registerRuleCommands } from "../commands/rule.js";
import { registerGuideCommands } from "../commands/guide.js";
import { registerSetupCommand } from "../commands/setup.js";
import { registerConfigCommand } from "../commands/config.js";

program
  .name("onchain-novel")
  .description("Onchain Novel Protocol CLI — create, write, vote, tip, and manage collaborative on-chain novels")
  .version("0.1.0");

registerSetupCommand(program);
registerConfigCommand(program);
registerNovelCommands(program);
registerChapterCommands(program);
registerVoteCommands(program);
registerTipCommands(program);
registerBountyCommands(program);
registerRuleCommands(program);
registerGuideCommands(program);

program.parse();

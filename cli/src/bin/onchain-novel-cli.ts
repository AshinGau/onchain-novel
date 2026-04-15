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

program
  .name("onchain-novel-cli")
  .description(
    "Onchain Novel Protocol CLI — create, write, vote, tip, and manage collaborative on-chain novels",
  )
  .version("0.1.0");

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

program.parse();

#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerBountyTools } from "./tools/bounty.js";
import { registerChapterTools } from "./tools/chapter.js";
import { registerNovelTools } from "./tools/novel.js";
import { registerRewardTools } from "./tools/reward.js";
import { registerRuleTools } from "./tools/rule.js";
import { registerTipTools } from "./tools/tip.js";
import { registerVoteTools } from "./tools/vote.js";

async function main() {
  const server = new McpServer({
    name: "onchain-novel",
    version: "0.2.0",
  });

  registerNovelTools(server);
  registerChapterTools(server);
  registerVoteTools(server);
  registerTipTools(server);
  registerBountyTools(server);
  registerRuleTools(server);
  registerRewardTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Onchain Novel MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

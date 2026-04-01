import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Tools
import { registerNovelTools } from "./tools/novel.js";
import { registerChapterTools } from "./tools/chapter.js";
import { registerVotingTools } from "./tools/voting.js";
import { registerPrizeTools } from "./tools/prize.js";
import { registerKeeperTools } from "./tools/keeper.js";

// Skills
import { registerWriterSkills } from "./skills/writer.js";
import { registerVoterSkills } from "./skills/voter.js";
import { registerKeeperSkills } from "./skills/keeper.js";

async function main() {
  const server = new McpServer({
    name: "onchain-novel",
    version: "0.1.0",
  });

  // Register all tools
  registerNovelTools(server);
  registerChapterTools(server);
  registerVotingTools(server);
  registerPrizeTools(server);
  registerKeeperTools(server);

  // Register all skills
  registerWriterSkills(server);
  registerVoterSkills(server);
  registerKeeperSkills(server);

  // Start with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Onchain Novel MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

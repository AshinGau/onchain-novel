import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatEther } from "viem";
import { novelCoreAbi } from "../abi/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient } from "../utils/wallet.js";
import { hasApi, apiFetch } from "../utils/api-client.js";
import { fetchRules } from "../utils/rules-fetcher.js";

export function registerRuleTools(server: McpServer): void {
  server.tool(
    "set_creator_rules",
    "Set initial world-building rules as the novel creator (only during epoch 1, no voting needed). Rules help AI agents maintain narrative consistency.",
    {
      novelId: z.number().describe("Novel ID"),
      rules: z.array(z.object({
        name: z.string().describe("Rule name (max 64 bytes)"),
        content: z.string().describe("Rule content"),
      })).describe("Array of rules to set"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const names = params.rules.map((r) => r.name);
        const contents = params.rules.map((r) => r.content);

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "setCreatorRules",
          args: [BigInt(params.novelId), names, contents],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [{
            type: "text" as const,
            text: `Set ${params.rules.length} rule(s) for Novel #${params.novelId}.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to set rules: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "propose_rule",
    "Propose adding or deleting a world-building rule. Requires paying the novel's ruleFee (goes to prize pool). Canon authors vote to approve.",
    {
      novelId: z.number().describe("Novel ID"),
      type: z.enum(["add", "delete"]).describe("Proposal type: 'add' to create a new rule, 'delete' to remove an existing one"),
      name: z.string().describe("Rule name (max 64 bytes)"),
      content: z.string().default("").describe("Rule content (required for add, ignored for delete)"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        // Read ruleFee from novel config
        const novel = await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getNovel",
          args: [BigInt(params.novelId)],
        }) as any;

        const ruleFee = novel.config.ruleFee as bigint;
        const proposalType = params.type === "add" ? 0 : 1;

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "proposeRule",
          args: [BigInt(params.novelId), proposalType, params.name, params.content],
          value: ruleFee,
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [{
            type: "text" as const,
            text: `Rule proposal submitted (${params.type}: "${params.name}").\nFee: ${formatEther(ruleFee)} ETH (deposited to prize pool)\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to propose rule: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "vote_on_rule_proposal",
    "Vote to approve a rule proposal. Only canon authors (those with at least one canon chapter) can vote. When quorum is reached, the rule is automatically applied.",
    {
      proposalId: z.number().describe("Rule proposal ID"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "voteOnRuleProposal",
          args: [BigInt(params.proposalId)],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [{
            type: "text" as const,
            text: `Voted on rule proposal #${params.proposalId}.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to vote: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_rules",
    "Get all world-building rules for a novel. Rules are metadata that help AI agents maintain narrative consistency (e.g., setting, characters, plot constraints).",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        const publicClient = getPublicClient();
        const rules = await fetchRules(params.novelId, publicClient);

        if (rules.length === 0) {
          return { content: [{ type: "text" as const, text: `No rules set for Novel #${params.novelId}.` }] };
        }

        const lines = rules.map((r) => `[${r.name}]\n${r.content}`);
        return { content: [{ type: "text" as const, text: `Rules for Novel #${params.novelId}:\n\n${lines.join("\n\n")}` }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to get rules: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_rule_proposals",
    "List rule proposals for a novel. Filter by status: active (pending vote), executed (approved), or all.",
    {
      novelId: z.number().describe("Novel ID"),
      status: z.enum(["active", "executed", "all"]).default("all").describe("Filter by proposal status"),
    },
    async (params) => {
      try {
        if (!hasApi()) {
          return { content: [{ type: "text" as const, text: "get_rule_proposals requires API_BASE_URL to be configured." }], isError: true };
        }

        const qs = params.status !== "all" ? `?status=${params.status}` : "";
        const proposals = await apiFetch<any[]>(`/api/novels/${params.novelId}/rule-proposals${qs}`);

        if (proposals.length === 0) {
          return { content: [{ type: "text" as const, text: `No rule proposals for Novel #${params.novelId}.` }] };
        }

        const typeNames = ["Add", "Delete"];
        const lines = proposals.map((p) =>
          `  #${p.id} [${typeNames[p.proposal_type]}] "${p.rule_name}" by ${p.proposer.slice(0, 10)}... | Votes: ${p.vote_count} | ${p.executed ? "Executed" : "Pending"}`
        );

        return { content: [{ type: "text" as const, text: `Rule proposals for Novel #${params.novelId}:\n${lines.join("\n")}` }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Failed: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}

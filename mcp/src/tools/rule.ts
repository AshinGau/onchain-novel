import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseEther } from "viem";
import {
  setCreatorRules,
  proposeRule,
  voteOnRuleProposal,
  buildWorldLineProof,
  getNovel,
  getRuleNames,
  getRule,
  getRuleProposal,
} from "../shared/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient } from "../utils/client.js";
import { ok, fail } from "../utils/response.js";

export function registerRuleTools(server: McpServer): void {
  // ── rule_list ──
  server.tool(
    "rule_list",
    "List all world-building rules for a novel.",
    { novelId: z.number().describe("Novel ID") },
    async (params) => {
      try {
        if (!config.rulesEngine) return fail("RULES_ENGINE_ADDRESS not configured.");
        const pub = getPublicClient();
        const names = (await getRuleNames(pub, BigInt(params.novelId), config.rulesEngine)) as string[];
        if (names.length === 0) return ok(`No rules for Novel #${params.novelId}.`);

        const rules: string[] = [];
        for (const name of names) {
          const content = (await getRule(pub, BigInt(params.novelId), name, config.rulesEngine)) as string;
          rules.push(`[${name}]\n${content}`);
        }
        return ok(`Rules for Novel #${params.novelId}:\n\n${rules.join("\n\n")}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── rule_set ──
  server.tool(
    "rule_set",
    "Set creator rules (creator only, epoch 1 only).",
    {
      novelId: z.number().describe("Novel ID"),
      rules: z.array(z.object({ name: z.string(), content: z.string() })).describe("Rules to set"),
    },
    async (params) => {
      try {
        if (!config.rulesEngine) return fail("RULES_ENGINE_ADDRESS not configured.");
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const hash = await setCreatorRules(wallet, {
          novelId: BigInt(params.novelId),
          names: params.rules.map((r) => r.name),
          contents: params.rules.map((r) => r.content),
          rulesEngine: config.rulesEngine,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(`${params.rules.length} rule(s) set for Novel #${params.novelId}.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── rule_propose ──
  server.tool(
    "rule_propose",
    "Propose adding or deleting a rule (costs ruleFee). Caller must be the author of `chapterId`, " +
      "and `chapterId` must currently be on a world line. The path proof is computed automatically.",
    {
      novelId: z.number().describe("Novel ID"),
      proposalType: z.number().describe("0 = Add, 1 = Delete"),
      ruleName: z.string().describe("Rule name"),
      ruleContent: z.string().default("").describe("Rule content (for Add type)"),
      chapterId: z.number().describe("Chapter ID authored by caller, currently on a world line"),
      feeEth: z.string().optional().describe("Fee in ETH (defaults to novel's ruleFee)"),
    },
    async (params) => {
      try {
        if (!config.rulesEngine) return fail("RULES_ENGINE_ADDRESS not configured.");
        const wallet = getWalletClient();
        const pub = getPublicClient();

        let value = params.feeEth ? parseEther(params.feeEth) : undefined;
        if (!value) {
          const novel = (await getNovel(pub, BigInt(params.novelId), config.novelCore)) as any;
          value = novel.config.ruleFee as bigint;
        }

        const path = await buildWorldLineProof(
          pub,
          config.novelCore,
          BigInt(params.novelId),
          BigInt(params.chapterId),
        );
        if (!path) {
          return fail(`Chapter #${params.chapterId} is not on any current world line of novel #${params.novelId}.`);
        }

        const hash = await proposeRule(wallet, {
          novelId: BigInt(params.novelId),
          proposalType: params.proposalType,
          ruleName: params.ruleName,
          ruleContent: params.ruleContent,
          chapterId: BigInt(params.chapterId),
          path,
          value,
          rulesEngine: config.rulesEngine,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(`Rule proposed.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── rule_vote ──
  server.tool(
    "rule_vote",
    "Vote on a rule proposal. Caller must be the author of `chapterId`, and `chapterId` must " +
      "currently be on a world line. The path proof is computed automatically.",
    {
      proposalId: z.number().describe("Proposal ID"),
      chapterId: z.number().describe("Chapter ID authored by caller, currently on a world line"),
    },
    async (params) => {
      try {
        if (!config.rulesEngine) return fail("RULES_ENGINE_ADDRESS not configured.");
        const wallet = getWalletClient();
        const pub = getPublicClient();

        // Derive novelId from the proposal so we can build the proof
        const proposal = (await getRuleProposal(pub, BigInt(params.proposalId), config.rulesEngine)) as any;
        const path = await buildWorldLineProof(pub, config.novelCore, proposal.novelId, BigInt(params.chapterId));
        if (!path) {
          return fail(
            `Chapter #${params.chapterId} is not on any current world line of novel #${proposal.novelId}.`,
          );
        }

        const hash = await voteOnRuleProposal(wallet, {
          proposalId: BigInt(params.proposalId),
          chapterId: BigInt(params.chapterId),
          path,
          rulesEngine: config.rulesEngine,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(`Voted on proposal #${params.proposalId}.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );
}

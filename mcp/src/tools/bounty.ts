import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseEther, formatEther } from "viem";
import { createBounty, claimBounty, refundBounty } from "../shared/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient } from "../utils/client.js";
import { ok, fail } from "../utils/response.js";

export function registerBountyTools(server: McpServer): void {
  // ── bounty_create ──
  server.tool(
    "bounty_create",
    "Create a bounty for chapter continuation. 20% goes to prize pool immediately, 80% locked for authors.",
    {
      chapterId: z.number().describe("Chapter ID to create bounty for"),
      value: z.string().describe("Bounty amount in ETH"),
      deadline: z.number().describe("Deadline duration in seconds from now"),
    },
    async (params) => {
      try {
        if (!config.bountyBoard) return fail("BOUNTY_BOARD_ADDRESS not configured.");
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const amount = parseEther(params.value);
        const hash = await createBounty(wallet, {
          chapterId: BigInt(params.chapterId),
          deadline: BigInt(params.deadline),
          value: amount,
          bountyBoard: config.bountyBoard,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(`Bounty created for Chapter #${params.chapterId}.\nAmount: ${formatEther(amount)} ETH\nTx: ${hash}\nBlock: ${receipt.blockNumber}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── bounty_claim ──
  server.tool(
    "bounty_claim",
    "Claim a bounty after submitting a continuation chapter and the deadline passes.",
    { bountyId: z.number().describe("Bounty ID") },
    async (params) => {
      try {
        if (!config.bountyBoard) return fail("BOUNTY_BOARD_ADDRESS not configured.");
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const hash = await claimBounty(wallet, BigInt(params.bountyId), config.bountyBoard);
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(`Bounty #${params.bountyId} claimed.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── bounty_refund ──
  server.tool(
    "bounty_refund",
    "Refund a bounty if no continuations were submitted before deadline.",
    { bountyId: z.number().describe("Bounty ID") },
    async (params) => {
      try {
        if (!config.bountyBoard) return fail("BOUNTY_BOARD_ADDRESS not configured.");
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const hash = await refundBounty(wallet, BigInt(params.bountyId), config.bountyBoard);
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(`Bounty #${params.bountyId} refunded.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );
}

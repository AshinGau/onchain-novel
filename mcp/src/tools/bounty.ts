import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatEther, parseEther } from "viem";
import { z } from "zod";

import { config } from "../config.js";
import { claimBounty, createBounty, designateBounty, refundBounty } from "../shared/index.js";
import { apiGet, hasApi } from "../utils/api.js";
import { getPublicClient, getWalletClient } from "../utils/client.js";
import { fail, inlineSafe, ok, sanitizeError } from "../utils/response.js";

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
        return ok(
          `Bounty created for Chapter #${params.chapterId}.\nAmount: ${formatEther(amount)} ETH\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
      }
    },
  );

  // ── bounty_designate ──
  server.tool(
    "bounty_designate",
    "Designate a preferred continuation for your bounty. Must be called before the deadline. The designated chapter's author receives the full 80% on claim.",
    {
      bountyId: z.number().describe("Bounty ID"),
      chapterId: z.number().describe("Chapter ID of the preferred continuation"),
    },
    async (params) => {
      try {
        if (!config.bountyBoard) return fail("BOUNTY_BOARD_ADDRESS not configured.");
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const hash = await designateBounty(wallet, {
          bountyId: BigInt(params.bountyId),
          chapterId: BigInt(params.chapterId),
          bountyBoard: config.bountyBoard,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(
          `Bounty #${params.bountyId} designated Chapter #${params.chapterId}.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
      }
    },
  );

  // ── bounty_active ──
  server.tool(
    "bounty_active",
    "List active bounties with earning opportunities. Returns bounties that haven't been claimed and whose deadline hasn't passed yet.",
    {
      novelId: z.number().optional().describe("Filter by novel ID (optional)"),
    },
    async (params) => {
      try {
        if (!hasApi()) return fail("bounty_active requires API_BASE_URL.");
        const qs = params.novelId ? `?novelId=${params.novelId}` : "";
        const data = await apiGet<{ bounties: Array<Record<string, unknown>> }>(
          `/api/bounties/active${qs}`,
        );
        if (data.bounties.length === 0) return ok("No active bounties found.");
        const lines = data.bounties.map((b: any) => {
          const createDate = b.create_time
            ? new Date(Number(b.create_time) * 1000).toISOString()
            : "?";
          const deadlineDate = new Date(Number(b.deadline) * 1000).toISOString();
          return `Bounty #${b.id} | Chapter #${b.chapter_id} (${inlineSafe(String(b.novel_title ?? ""), 60)}) | ${formatEther(BigInt(b.locked_amount))} ETH locked | Window: ${createDate} → ${deadlineDate}${b.designated_chapter_id > 0 ? ` | Designated: Chapter #${b.designated_chapter_id}` : ""}`;
        });
        return ok(`Active bounties (${data.bounties.length}):\n${lines.join("\n")}`);
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
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
        return ok(
          `Bounty #${params.bountyId} claimed.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
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
        return ok(
          `Bounty #${params.bountyId} refunded.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
      }
    },
  );
}

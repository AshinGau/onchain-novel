import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatEther } from "viem";
import { z } from "zod";

import { config } from "../config.js";
import { claimReward, claimVotingReward } from "../shared/index.js";
import { apiGet, hasApi } from "../utils/api.js";
import { getPublicClient, getWalletClient } from "../utils/client.js";
import { fail, inlineSafe, ok, sanitizeError } from "../utils/response.js";

export function registerRewardTools(server: McpServer): void {
  // ── reward_claim ──
  server.tool(
    "reward_claim",
    "Claim accumulated author/creator rewards on a novel (NovelCore.claimReward). " +
      "Pulls the caller's cumulative share: creator royalty D/(D+round) + per-chapter author rewards " +
      "credited during settled rounds. Safe to call any time rewards are pending.",
    { novelId: z.number().describe("Novel ID") },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const hash = await claimReward(wallet, BigInt(params.novelId), config.novelCore);
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(
          `Reward claimed for Novel #${params.novelId}.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
      }
    },
  );

  // ── reward_claim_voting ──
  server.tool(
    "reward_claim_voting",
    "Claim the voter reward for a specific settled round (RoundManager.claimVotingReward). " +
      "Voters who revealed receive 1x weight; voters who backed a winning world-line receive 3x weight. " +
      "Call reward_status first to find unclaimed (novelId, round) pairs.",
    {
      novelId: z.number().describe("Novel ID"),
      round: z.number().describe("Settled round number to claim"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const hash = await claimVotingReward(
          wallet,
          BigInt(params.novelId),
          params.round,
          config.roundManager,
        );
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(
          `Voting reward claimed for Novel #${params.novelId} round ${params.round}.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
      }
    },
  );

  // ── reward_status ──
  server.tool(
    "reward_status",
    "Show unclaimed voting rewards and past claim history for an address (defaults to connected wallet). " +
      "Use this to discover claimable rewards before calling reward_claim_voting / reward_claim.",
    {
      address: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address")
        .optional()
        .describe("Address (defaults to connected wallet)"),
    },
    async (params) => {
      try {
        if (!hasApi()) return fail("reward_status requires API_BASE_URL.");
        let addr = params.address;
        if (!addr) {
          const wallet = getWalletClient();
          addr = wallet.account!.address;
        }
        const data = await apiGet<{
          unclaimedVotes: { novel_id: string; round: number; novel_title: string | null }[];
          rewardClaims: {
            novel_id: string;
            source: string;
            amount: string;
            round: number | null;
            novel_title: string | null;
          }[];
        }>(`/api/users/${addr.toLowerCase()}/rewards`);

        const lines: string[] = [`Rewards for ${addr}:`];
        if (data.unclaimedVotes.length === 0) {
          lines.push("  No unclaimed voting rewards.");
        } else {
          lines.push("  Unclaimed voting rewards (run reward_claim_voting):");
          for (const v of data.unclaimedVotes) {
            lines.push(
              `    Novel #${v.novel_id}${v.novel_title ? ` "${inlineSafe(v.novel_title, 60)}"` : ""} round ${v.round}`,
            );
          }
        }
        if (data.rewardClaims.length > 0) {
          lines.push(`  Past claims (${data.rewardClaims.length}):`);
          for (const c of data.rewardClaims.slice(0, 10)) {
            lines.push(
              `    Novel #${c.novel_id}${c.round !== null ? ` r${c.round}` : ""} ${c.source}: ${formatEther(BigInt(c.amount))} ETH`,
            );
          }
        }
        return ok(lines.join("\n"));
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
      }
    },
  );
}

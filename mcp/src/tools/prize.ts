import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseEther, formatEther } from "viem";
import { prizePoolAbi } from "../abi/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient, getWalletAddress } from "../utils/wallet.js";

export function registerPrizeTools(server: McpServer): void {
  server.tool(
    "tip_novel",
    "Tip a novel's prize pool. Minimum 0.001 ETH. Tips increase the reward pool for canon authors and voters.",
    {
      novelId: z.number().describe("Novel ID to tip"),
      amountEth: z.string().describe("Amount to tip in ETH (e.g. '0.1')"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.prizePoolAddress,
          abi: prizePoolAbi,
          functionName: "tipNovel",
          args: [BigInt(params.novelId)],
          value: parseEther(params.amountEth),
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Tipped Novel #${params.novelId} with ${params.amountEth} ETH.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to tip: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "claim_reward",
    "Claim pending prize pool rewards (author rewards, creator royalties, keeper rewards).",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.prizePoolAddress,
          abi: prizePoolAbi,
          functionName: "claimReward",
          args: [BigInt(params.novelId)],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Reward claimed for Novel #${params.novelId}.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to claim reward: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_pool_balance",
    "Get the current prize pool balance for a novel.",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        const publicClient = getPublicClient();

        const balance = (await publicClient.readContract({
          address: config.prizePoolAddress,
          abi: prizePoolAbi,
          functionName: "getPoolBalance",
          args: [BigInt(params.novelId)],
        })) as bigint;

        return {
          content: [
            {
              type: "text" as const,
              text: `Novel #${params.novelId} prize pool: ${formatEther(balance)} ETH`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get pool balance: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_pending_reward",
    "Get the pending (claimable) reward for an address in a novel's prize pool.",
    {
      novelId: z.number().describe("Novel ID"),
      address: z.string().optional().describe("Address to check (defaults to wallet address)"),
    },
    async (params) => {
      try {
        const publicClient = getPublicClient();
        const addr = (params.address || getWalletAddress()) as `0x${string}`;

        const reward = (await publicClient.readContract({
          address: config.prizePoolAddress,
          abi: prizePoolAbi,
          functionName: "getPendingReward",
          args: [BigInt(params.novelId), addr],
        })) as bigint;

        return {
          content: [
            {
              type: "text" as const,
              text: `Pending reward for ${addr} in Novel #${params.novelId}: ${formatEther(reward)} ETH`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get pending reward: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

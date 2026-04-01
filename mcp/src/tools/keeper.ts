import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { novelCoreAbi } from "../abi/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient } from "../utils/wallet.js";

export function registerKeeperTools(server: McpServer): void {
  server.tool(
    "close_submissions",
    "Transition a novel from Submitting to Committing phase. Requires minimum duration elapsed and minimum submissions met.",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "closeSubmissions",
          args: [BigInt(params.novelId)],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Submissions closed for Novel #${params.novelId}. Now in Committing phase.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to close submissions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "close_commit",
    "Transition a novel from Committing to Revealing phase. Requires commit duration to have elapsed.",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "closeCommit",
          args: [BigInt(params.novelId)],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Commit phase closed for Novel #${params.novelId}. Now in Revealing phase.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to close commit: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "settle_round",
    "Settle a round: tally votes, select top N world lines, process pollution, return stakes. Requires reveal duration to have elapsed.",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "settleRound",
          args: [BigInt(params.novelId)],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Round settled for Novel #${params.novelId}.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to settle round: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "close_epoch_commit",
    "Transition epoch from Committing to Revealing phase. Requires commit duration elapsed.",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "closeEpochCommit",
          args: [BigInt(params.novelId)],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Epoch commit closed for Novel #${params.novelId}. Now in Epoch Revealing phase.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to close epoch commit: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "settle_epoch",
    "Settle an epoch: tally epoch votes, establish canon, mint NFTs, distribute rewards. Requires reveal duration elapsed.",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "settleEpoch",
          args: [BigInt(params.novelId)],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Epoch settled for Novel #${params.novelId}. Canon established, NFTs minted, rewards distributed.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to settle epoch: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "trigger_early_epoch",
    "Force early epoch transition (owner only). Skips remaining rounds and enters epoch voting.",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "triggerEarlyEpoch",
          args: [BigInt(params.novelId)],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Early epoch triggered for Novel #${params.novelId}. Now in Epoch Committing phase.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to trigger early epoch: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

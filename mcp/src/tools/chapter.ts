import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseEther, formatEther } from "viem";
import { novelCoreAbi } from "../abi/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient, getWalletAddress } from "../utils/wallet.js";

export function registerChapterTools(server: McpServer): void {
  server.tool(
    "submit_chapter",
    "Submit a new chapter to a novel. Must be in Submitting phase. Requires staking ETH. The chapter must extend an active world line.",
    {
      novelId: z.number().describe("Novel ID"),
      parentChapterId: z.number().describe("Parent chapter ID (must be an active world line)"),
      contentHash: z.string().describe("bytes32 content hash (IPFS/Arweave CID hash)"),
      declaredLength: z.number().describe("Declared content byte length"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        // Fetch novel to get stake amount
        const novel = (await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getNovel",
          args: [BigInt(params.novelId)],
        })) as { config: { stakeAmount: bigint } };

        const stakeAmount = novel.config.stakeAmount;

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "submitChapter",
          args: [
            BigInt(params.novelId),
            BigInt(params.parentChapterId),
            params.contentHash as `0x${string}`,
            BigInt(params.declaredLength),
          ],
          value: stakeAmount,
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Chapter submitted to Novel #${params.novelId}.\nParent: Chapter #${params.parentChapterId}\nStake: ${formatEther(stakeAmount)} ETH\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to submit chapter: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_chapter",
    "Get details of a specific chapter by ID, including its author, content hash, voting status, and world line / canon status.",
    {
      chapterId: z.number().describe("Chapter ID to query"),
    },
    async (params) => {
      try {
        const publicClient = getPublicClient();

        const chapter = (await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getChapter",
          args: [BigInt(params.chapterId)],
        })) as {
          id: bigint;
          novelId: bigint;
          parentId: bigint;
          author: string;
          contentHash: string;
          declaredLength: bigint;
          round: number;
          epoch: number;
          voteCount: bigint;
          isWorldLine: boolean;
          isCanon: boolean;
        };

        if (chapter.id === 0n) {
          return {
            content: [
              { type: "text" as const, text: `Chapter ${params.chapterId} not found.` },
            ],
          };
        }

        const info = [
          `Chapter #${chapter.id}`,
          `Novel: #${chapter.novelId}`,
          `Parent: ${chapter.parentId === 0n ? "Genesis (root)" : `#${chapter.parentId}`}`,
          `Author: ${chapter.author}`,
          `Content Hash: ${chapter.contentHash}`,
          `Declared Length: ${chapter.declaredLength} bytes`,
          `Round: ${chapter.round}, Epoch: ${chapter.epoch}`,
          `Vote Count: ${chapter.voteCount}`,
          `World Line: ${chapter.isWorldLine}`,
          `Canon: ${chapter.isCanon}`,
        ].join("\n");

        return { content: [{ type: "text" as const, text: info }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get chapter: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_round_submissions",
    "Get all chapter IDs submitted in a specific round of a novel.",
    {
      novelId: z.number().describe("Novel ID"),
      round: z.number().describe("Round number to query"),
    },
    async (params) => {
      try {
        const publicClient = getPublicClient();

        const submissions = (await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getRoundSubmissions",
          args: [BigInt(params.novelId), params.round],
        })) as bigint[];

        if (submissions.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No submissions in Novel #${params.novelId} Round ${params.round}.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Novel #${params.novelId} Round ${params.round} submissions (${submissions.length}):\n${submissions.map((id) => `  - Chapter #${id}`).join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get submissions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_claimable_stake",
    "Get the claimable (unlocked) stake balance for an author in a novel.",
    {
      novelId: z.number().describe("Novel ID"),
      address: z.string().optional().describe("Author address (defaults to wallet address)"),
    },
    async (params) => {
      try {
        const publicClient = getPublicClient();
        const addr = (params.address || getWalletAddress()) as `0x${string}`;

        const claimable = (await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getClaimableStake",
          args: [BigInt(params.novelId), addr],
        })) as bigint;

        return {
          content: [
            {
              type: "text" as const,
              text: `Claimable stake for ${addr} in Novel #${params.novelId}: ${formatEther(claimable)} ETH`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get claimable stake: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { keccak256, toBytes, formatEther } from "viem";
import { novelCoreAbi } from "../abi/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient } from "../utils/wallet.js";
import { traceCanonChain, assembleStoryText } from "../utils/content-bridge.js";

export function registerWriterSkills(server: McpServer): void {
  server.tool(
    "writer_get_context",
    "Writer Skill: Fetch the writing context for a novel. Returns active world lines and their story chains, providing structured context for an LLM to write a continuation chapter.",
    {
      novelId: z.number().describe("Novel ID to get writing context for"),
    },
    async (params) => {
      try {
        const publicClient = getPublicClient();

        // Get novel state
        const novel = (await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getNovel",
          args: [BigInt(params.novelId)],
        })) as {
          id: bigint;
          currentRound: number;
          currentEpoch: number;
          roundPhase: number;
          epochPhase: number;
          active: boolean;
          config: { stakeAmount: bigint; minChapterLength: bigint; maxChapterLength: bigint };
        };

        if (novel.id === 0n) {
          return {
            content: [
              { type: "text" as const, text: `Novel ${params.novelId} not found.` },
            ],
          };
        }

        const ROUND_PHASES = ["Submitting", "Committing", "Revealing", "Settling"];

        // Get active world lines
        const worldLines = (await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getActiveWorldLines",
          args: [BigInt(params.novelId)],
        })) as bigint[];

        // Trace each world line's story chain
        const worldLineContexts: string[] = [];
        for (const wlId of worldLines) {
          const chain = await traceCanonChain(publicClient, wlId);
          const storyText = assembleStoryText(chain);
          worldLineContexts.push(
            `=== World Line: Chapter #${wlId} ===\n${storyText}`
          );
        }

        const context = [
          `# Writing Context for Novel #${params.novelId}`,
          ``,
          `## Status`,
          `- Epoch: ${novel.currentEpoch}, Round: ${novel.currentRound}`,
          `- Phase: ${ROUND_PHASES[novel.roundPhase]}`,
          `- Active: ${novel.active}`,
          `- Stake Required: ${formatEther(novel.config.stakeAmount)} ETH`,
          `- Chapter Length: ${novel.config.minChapterLength}-${novel.config.maxChapterLength} bytes`,
          ``,
          `## Active World Lines (${worldLines.length})`,
          `These are the story branches you can extend. Pick one as your parent chapter.`,
          ``,
          ...worldLineContexts,
          ``,
          `## Instructions`,
          `1. Choose a world line to extend (use its chapter ID as parentChapterId)`,
          `2. Write your chapter continuation (${novel.config.minChapterLength}-${novel.config.maxChapterLength} bytes)`,
          `3. Upload content to IPFS/Arweave and get the content hash`,
          `4. Use submit_chapter or writer_submit to submit on-chain`,
        ].join("\n");

        return { content: [{ type: "text" as const, text: context }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get writing context: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "writer_submit",
    "Writer Skill: Submit a chapter with content. Computes a mock content hash (keccak256 of content string) and submits on-chain. In production, content would be uploaded to IPFS first.",
    {
      novelId: z.number().describe("Novel ID"),
      parentChapterId: z.number().describe("Parent chapter ID (must be an active world line)"),
      content: z.string().describe("The chapter content text"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        // Compute content hash (mock: just keccak256 of the content string)
        const contentBytes = toBytes(params.content);
        const contentHash = keccak256(contentBytes);
        const declaredLength = BigInt(contentBytes.length);

        // Fetch novel to get stake amount
        const novel = (await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getNovel",
          args: [BigInt(params.novelId)],
        })) as { config: { stakeAmount: bigint } };

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "submitChapter",
          args: [
            BigInt(params.novelId),
            BigInt(params.parentChapterId),
            contentHash,
            declaredLength,
          ],
          value: novel.config.stakeAmount,
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Chapter submitted successfully!`,
                `Content Hash: ${contentHash}`,
                `Declared Length: ${declaredLength} bytes`,
                `Stake: ${formatEther(novel.config.stakeAmount)} ETH`,
                `Transaction: ${hash}`,
                `Block: ${receipt.blockNumber}`,
                ``,
                `Note: In production, upload content to IPFS/Arweave first and use the real CID hash.`,
              ].join("\n"),
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
}

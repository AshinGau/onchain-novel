import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { keccak256, toBytes, formatEther } from "viem";
import { novelCoreAbi } from "../abi/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient } from "../utils/wallet.js";
import { traceCanonChain, assembleStoryText } from "../utils/content-bridge.js";
import { hasApi, apiFetch } from "../utils/api-client.js";
import { fetchRules, formatRulesForWriter } from "../utils/rules-fetcher.js";

export function registerWriterSkills(server: McpServer): void {
  server.tool(
    "writer_get_context",
    "Writer Skill: Fetch the writing context for a novel. Returns active world lines with their full story chains (including content text when API is configured).",
    {
      novelId: z.number().describe("Novel ID to get writing context for"),
    },
    async (params) => {
      try {
        // ── API path: richer context with content text ──
        if (hasApi()) {
          const novel = await apiFetch<{
            id: string; title: string; current_round: number; current_epoch: number;
            round_phase: number; epoch_phase: number; active: boolean;
            config: { stakeAmount: string; minChapterLength: string; maxChapterLength: string };
          }>(`/api/novels/${params.novelId}`);

          const ROUND_PHASES = ["Submitting", "Committing", "Revealing", "Settling"];

          const wlData = await apiFetch<{ worldlines: { id: string; author: string; chapter_index: number; vote_count: string }[] }>(
            `/api/novels/${params.novelId}/worldlines`
          );

          // Fetch story context for each world line (with content text)
          const worldLineContexts: string[] = [];
          for (const wl of wlData.worldlines) {
            const ctxData = await apiFetch<{ ancestors: { id: string; author: string; chapter_index: number; content_text: string | null; is_canon: boolean }[] }>(
              `/api/chapters/${wl.id}/context`
            );
            const parts = ctxData.ancestors.map((ch) => {
              const label = ch.chapter_index === 0 ? "Genesis" : `Chapter ${ch.chapter_index}`;
              const body = ch.content_text || `[Content hash only — not fetched]`;
              return `  [${label}] by ${ch.author}${ch.is_canon ? " [Canon]" : ""}:\n  ${body}`;
            });
            worldLineContexts.push(
              `=== World Line: Chapter #${wl.id} (${wl.vote_count} votes, by ${wl.author}) ===\n${parts.join("\n\n")}`
            );
          }

          // Fetch rules
          const rules = await fetchRules(params.novelId);
          const rulesSection = formatRulesForWriter(rules);

          const context = [
            `# Writing Context for Novel #${params.novelId}: ${novel.title}`,
            ``,
            `## Status`,
            `- Epoch: ${novel.current_epoch}, Round: ${novel.current_round}`,
            `- Phase: ${ROUND_PHASES[novel.round_phase]}`,
            `- Active: ${novel.active}`,
            `- Stake Required: ${formatEther(BigInt(novel.config.stakeAmount))} ETH`,
            `- Chapter Length: ${novel.config.minChapterLength}-${novel.config.maxChapterLength} bytes`,
            ``,
            rulesSection,
            ``,
            `## Active World Lines (${wlData.worldlines.length})`,
            `These are the story branches you can extend. Pick one as your parent chapter.`,
            ``,
            ...worldLineContexts,
            ``,
            `## Instructions`,
            `1. Choose a world line to extend (use its chapter ID as parentChapterId)`,
            `2. Write your chapter continuation (${novel.config.minChapterLength}-${novel.config.maxChapterLength} bytes)`,
            `3. Use writer_submit to submit on-chain`,
          ].filter(Boolean).join("\n");

          return { content: [{ type: "text" as const, text: context }] };
        }

        // ── Fallback: read from chain (no content text) ──
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

        // Fetch rules
        const rules = await fetchRules(params.novelId, publicClient);
        const rulesSection = formatRulesForWriter(rules);

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
          rulesSection,
          ``,
          `## Active World Lines (${worldLines.length})`,
          `These are the story branches you can extend. Pick one as your parent chapter.`,
          ``,
          ...worldLineContexts,
          ``,
          `## Instructions`,
          `1. Choose a world line to extend (use its chapter ID as parentChapterId)`,
          `2. Write your chapter continuation (${novel.config.minChapterLength}-${novel.config.maxChapterLength} bytes)`,
          `3. Use writer_submit to submit on-chain`,
        ].filter(Boolean).join("\n");

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
    "Writer Skill: Submit a chapter with content. Computes content hash (keccak256) and submits on-chain with the required stake.",
    {
      novelId: z.number().describe("Novel ID"),
      parentChapterId: z.number().describe("Parent chapter ID (must be an active world line)"),
      content: z.string().describe("The chapter content text"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        // Compute content hash
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

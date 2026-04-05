import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseEther, formatEther, keccak256, toHex, toBytes } from "viem";
import { novelCoreAbi } from "../abi/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient, getWalletAddress } from "../utils/wallet.js";
import { hasApi, apiFetch } from "../utils/api-client.js";

export function registerChapterTools(server: McpServer): void {
  server.tool(
    "submit_chapter",
    "Submit a new chapter to a novel. Must be in Submitting phase. Requires staking ETH. The chapter must extend an active world line.",
    {
      novelId: z.number().describe("Novel ID"),
      parentChapterId: z.number().describe("Parent chapter ID (must be an active world line)"),
      content: z.string().describe("Chapter content text"),
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

        // Build ContentSubmission from content string
        const contentBytes = toHex(toBytes(params.content));
        const submission = {
          contentHash: keccak256(contentBytes),
          declaredLength: BigInt(toBytes(params.content).length),
          content: contentBytes,
        };

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "submitChapter",
          args: [BigInt(params.novelId), BigInt(params.parentChapterId), submission],
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
    "Get details of a specific chapter by ID. When API is configured, also returns the full content text and comment count.",
    {
      chapterId: z.number().describe("Chapter ID to query"),
    },
    async (params) => {
      try {
        // Prefer API — returns content_text, novel_title, config
        if (hasApi()) {
          const ch = await apiFetch<Record<string, unknown>>(`/api/chapters/${params.chapterId}`);
          if (!ch) {
            return { content: [{ type: "text" as const, text: `Chapter ${params.chapterId} not found.` }] };
          }
          const info = [
            `Chapter #${ch.id}`,
            `Novel: #${ch.novel_id} (${ch.novel_title})`,
            `Parent: ${ch.parent_id === "0" ? "Genesis (root)" : `#${ch.parent_id}`}`,
            `Author: ${ch.author}`,
            `Chapter Index: ${ch.chapter_index}`,
            `Round: ${ch.round}, Epoch: ${ch.epoch}`,
            `Vote Count: ${ch.vote_count}`,
            `World Line: ${ch.is_world_line}`,
            `Canon: ${ch.is_canon}`,
            `Content Hash: ${ch.content_hash}`,
            `Declared Length: ${ch.declared_length} bytes`,
          ];
          if (ch.content_text) {
            info.push(`\n--- Content ---\n${ch.content_text}`);
          } else if (ch.content_fetched === false) {
            info.push(`Content: not yet fetched by indexer`);
          }
          return { content: [{ type: "text" as const, text: info.join("\n") }] };
        }

        // Fallback: read from chain
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
          chapterIndex: number;
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
          `Chapter Index: ${chapter.chapterIndex} (story position, genesis=0)`,
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
    "Get all chapter IDs submitted in a specific round of a novel. When API is configured, includes content text and comment counts.",
    {
      novelId: z.number().describe("Novel ID"),
      epoch: z.number().describe("Epoch number"),
      round: z.number().describe("Round number to query"),
    },
    async (params) => {
      try {
        if (hasApi()) {
          const data = await apiFetch<{ chapters: { id: string; author: string; chapter_index: number; vote_count: string; is_world_line: boolean; content_text?: string | null; comment_count?: string | number }[] }>(
            `/api/novels/${params.novelId}/rounds/${params.round}?epoch=${params.epoch}`
          );
          if (data.chapters.length === 0) {
            return { content: [{ type: "text" as const, text: `No submissions in Novel #${params.novelId} Epoch ${params.epoch} Round ${params.round}.` }] };
          }
          const lines = data.chapters.map((ch) => {
            const parts = [`  - Chapter #${ch.id} by ${ch.author.slice(0, 10)}... (${ch.vote_count} votes${ch.is_world_line ? ", WL" : ""})`];
            if (ch.comment_count && Number(ch.comment_count) > 0) parts[0] += ` [${ch.comment_count} comments]`;
            return parts[0];
          });
          return {
            content: [{
              type: "text" as const,
              text: `Novel #${params.novelId} Epoch ${params.epoch} Round ${params.round} submissions (${data.chapters.length}):\n${lines.join("\n")}`,
            }],
          };
        }

        const publicClient = getPublicClient();

        const submissions = (await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getRoundSubmissions",
          args: [BigInt(params.novelId), params.epoch, params.round],
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

  // ── API-only chapter tools ──────────────────────────────────────

  server.tool(
    "get_chapter_context",
    "Get the full ancestor chain of a chapter with content text for each ancestor. Essential for understanding the complete story before writing a continuation. Requires API_BASE_URL.",
    {
      chapterId: z.number().describe("Chapter ID to trace back from"),
    },
    async (params) => {
      try {
        if (!hasApi()) {
          return { content: [{ type: "text" as const, text: "get_chapter_context requires API_BASE_URL to be configured." }], isError: true };
        }
        const data = await apiFetch<{ ancestors: { id: string; parent_id: string; author: string; chapter_index: number; content_text: string | null; is_canon: boolean }[] }>(
          `/api/chapters/${params.chapterId}/context`
        );
        if (data.ancestors.length === 0) {
          return { content: [{ type: "text" as const, text: `Chapter ${params.chapterId} not found.` }] };
        }
        const parts = data.ancestors.map((ch, i) => {
          const label = ch.chapter_index === 0 ? "Genesis" : `Chapter ${ch.chapter_index}`;
          const lines = [`--- ${label} (ID #${ch.id}) by ${ch.author} ${ch.is_canon ? "[Canon]" : ""} ---`];
          if (ch.content_text) {
            lines.push(ch.content_text);
          } else {
            lines.push("[Content not available]");
          }
          return lines.join("\n");
        });
        return {
          content: [{
            type: "text" as const,
            text: `Story chain for Chapter #${params.chapterId} (${data.ancestors.length} chapters):\n\n${parts.join("\n\n")}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_chapter_comments",
    "Get comments on a chapter. Useful for understanding community feedback before writing or voting. Requires API_BASE_URL.",
    {
      chapterId: z.number().describe("Chapter ID"),
      page: z.number().default(1).describe("Page number"),
    },
    async (params) => {
      try {
        if (!hasApi()) {
          return { content: [{ type: "text" as const, text: "get_chapter_comments requires API_BASE_URL to be configured." }], isError: true };
        }
        const data = await apiFetch<{ comments: { id: string; author_address: string; content: string; created_at: string }[] }>(
          `/api/chapters/${params.chapterId}/comments?page=${params.page}`
        );
        if (data.comments.length === 0) {
          return { content: [{ type: "text" as const, text: `No comments on Chapter #${params.chapterId}.` }] };
        }
        const lines = data.comments.map(
          (c) => `  [${c.created_at}] ${c.author_address?.slice(0, 10) ?? "anon"}...: ${c.content}`
        );
        return {
          content: [{
            type: "text" as const,
            text: `Comments on Chapter #${params.chapterId} (${data.comments.length}):\n${lines.join("\n")}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "read_canon",
    "Read the canon (official) storyline of a novel with full content text. Requires API_BASE_URL.",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        if (!hasApi()) {
          return { content: [{ type: "text" as const, text: "read_canon requires API_BASE_URL to be configured." }], isError: true };
        }
        const data = await apiFetch<{ chapters: { id: string; author: string; chapter_index: number; content_text: string | null; content_fetched: boolean }[] }>(
          `/api/novels/${params.novelId}/canon`
        );
        if (data.chapters.length === 0) {
          return { content: [{ type: "text" as const, text: `No canon chapters for Novel #${params.novelId} yet.` }] };
        }
        const parts = data.chapters.map((ch) => {
          const label = ch.chapter_index === 0 ? "Genesis" : `Chapter ${ch.chapter_index}`;
          const header = `--- ${label} (ID #${ch.id}) by ${ch.author} ---`;
          const body = ch.content_text || "[Content not available]";
          return `${header}\n${body}`;
        });
        return {
          content: [{
            type: "text" as const,
            text: `Canon storyline for Novel #${params.novelId} (${data.chapters.length} chapters):\n\n${parts.join("\n\n")}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_my_chapters",
    "Get all chapters submitted by the current wallet (or a specified address) across all novels. Requires API_BASE_URL.",
    {
      address: z.string().optional().describe("Author address (defaults to wallet address)"),
    },
    async (params) => {
      try {
        if (!hasApi()) {
          return { content: [{ type: "text" as const, text: "get_my_chapters requires API_BASE_URL to be configured." }], isError: true };
        }
        const addr = params.address || getWalletAddress();
        const data = await apiFetch<{ chapters: { id: string; novel_id: string; chapter_index: number; round: number; epoch: number; vote_count: string; is_world_line: boolean; is_canon: boolean; novel_title: string }[] }>(
          `/api/users/${addr}/chapters`
        );
        if (data.chapters.length === 0) {
          return { content: [{ type: "text" as const, text: `No chapters found for ${addr}.` }] };
        }
        const lines = data.chapters.map((ch) =>
          `  #${ch.id} Novel "${ch.novel_title}" (E${ch.epoch}R${ch.round}) idx=${ch.chapter_index} ${ch.vote_count} votes${ch.is_world_line ? " [WL]" : ""}${ch.is_canon ? " [Canon]" : ""}`
        );
        return {
          content: [{
            type: "text" as const,
            text: `Chapters by ${addr} (${data.chapters.length}):\n${lines.join("\n")}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}

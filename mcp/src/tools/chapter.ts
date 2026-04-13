import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatEther } from "viem";
import {
  submitChapter,
  getNovel,
  getChapter,
  buildContentSubmission,
} from "../shared/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient } from "../utils/client.js";
import { hasApi, apiGet, apiPost } from "../utils/api.js";
import { ok, fail } from "../utils/response.js";

export function registerChapterTools(server: McpServer): void {
  // ── chapter_submit ──
  server.tool(
    "chapter_submit",
    "Submit a chapter to a novel. Pays the submission fee automatically.",
    {
      novelId: z.number().describe("Novel ID"),
      parentId: z.number().describe("Parent chapter ID to continue from"),
      content: z.string().describe("Chapter text content"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const submission = buildContentSubmission(params.content);

        // Get submission fee from novel config
        const novel = (await getNovel(pub, BigInt(params.novelId), config.novelCore)) as any;
        const fee = novel.config.submissionFee as bigint;

        const hash = await submitChapter(wallet, {
          novelId: BigInt(params.novelId),
          parentId: BigInt(params.parentId),
          submission,
          value: fee,
          novelCore: config.novelCore,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(
          `Chapter submitted.\nContent hash: ${submission.contentHash}\nLength: ${submission.declaredLength} bytes\nFee: ${formatEther(fee)} ETH\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── chapter_read ──
  server.tool(
    "chapter_read",
    "Read a chapter's metadata and content.",
    { chapterId: z.number().describe("Chapter ID") },
    async (params) => {
      try {
        if (hasApi()) {
          const ch = await apiGet<Record<string, unknown>>(`/api/chapters/${params.chapterId}`);
          if (!ch) return ok(`Chapter ${params.chapterId} not found.`);
          const lines = [
            `Chapter #${ch.id} (Novel #${ch.novel_id})`,
            `Author: ${ch.author}`,
            `Parent: ${ch.parent_id}`,
            `Depth: ${ch.depth}`,
            `Is World Line: ${ch.is_world_line}`,
            ch.content_text ? `\n--- Content ---\n${ch.content_text}` : `Content hash: ${ch.content_hash}`,
          ];
          return ok(lines.join("\n"));
        }

        const pub = getPublicClient();
        const ch = (await getChapter(pub, BigInt(params.chapterId), config.novelCore)) as any;
        if (ch.id === 0n) return ok(`Chapter ${params.chapterId} not found.`);
        return ok(
          [
            `Chapter #${ch.id} (Novel #${ch.novelId})`,
            `Author: ${ch.author}`,
            `Parent: ${ch.parentId}`,
            `Depth: ${ch.depth}`,
            `Content hash: ${ch.contentHash}`,
            `Length: ${ch.declaredLength} bytes`,
            `Children: ${ch.children.length}`,
          ].join("\n"),
        );
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── chapter_tree ──
  server.tool(
    "chapter_tree",
    "View the chapter tree for a novel, showing world lines and branches. Requires API.",
    { novelId: z.number().describe("Novel ID") },
    async (params) => {
      try {
        if (!hasApi()) return fail("chapter_tree requires API_BASE_URL.");
        const data = await apiGet<{
          chapters: { id: string; parent_id: string; depth: number; author: string; is_world_line: boolean; is_canon: boolean }[];
        }>(`/api/novels/${params.novelId}/chapters`);

        if (data.chapters.length === 0) return ok("No chapters.");

        const lines = data.chapters.map((ch) => {
          const indent = "  ".repeat(ch.depth);
          const flags = [ch.is_world_line ? "WL" : "", ch.is_canon ? "Canon" : ""].filter(Boolean).join(",");
          return `${indent}#${ch.id} (d${ch.depth}) by ${(ch.author as string).slice(0, 10)}...${flags ? ` [${flags}]` : ""}`;
        });
        return ok(`Chapter tree for Novel #${params.novelId}:\n${lines.join("\n")}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── chapter_context ──
  server.tool(
    "chapter_context",
    "Get the ancestor chain from root to a chapter, with content. Requires API.",
    { chapterId: z.number().describe("Chapter ID") },
    async (params) => {
      try {
        if (!hasApi()) return fail("chapter_context requires API_BASE_URL.");
        const data = await apiGet<{
          ancestors: { id: string; author: string; depth: number; content_text: string | null; is_canon: boolean }[];
        }>(`/api/chapters/${params.chapterId}/context`);

        const parts = data.ancestors.map((ch) => {
          const label = ch.depth === 1 ? "Root" : `Chapter #${ch.id} (depth ${ch.depth})`;
          const body = ch.content_text || "[no content]";
          return `--- ${label} by ${ch.author}${ch.is_canon ? " [Canon]" : ""} ---\n${body}`;
        });
        return ok(parts.join("\n\n"));
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── chapter_comments ──
  server.tool(
    "chapter_comments",
    "List off-chain comments on a chapter. Requires API.",
    {
      chapterId: z.number().describe("Chapter ID"),
      page: z.number().default(1),
      limit: z.number().default(20),
    },
    async (params) => {
      try {
        if (!hasApi()) return fail("chapter_comments requires API_BASE_URL.");
        const data = await apiGet<{
          comments: { id: number; author: string; content: string; created_at: string }[];
        }>(`/api/chapters/${params.chapterId}/comments?page=${params.page}&limit=${params.limit}`);
        if (data.comments.length === 0) return ok(`No comments on Chapter #${params.chapterId}.`);
        const lines = data.comments.map(
          (c) => `  #${c.id} ${c.author.slice(0, 10)}... (${c.created_at}): ${c.content}`,
        );
        return ok(`Comments on Chapter #${params.chapterId}:\n${lines.join("\n")}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── chapter_comment ──
  server.tool(
    "chapter_comment",
    "Post an off-chain comment on a chapter. Wallet signs canonical message; no on-chain tx.",
    {
      chapterId: z.number().describe("Chapter ID"),
      content: z.string().describe("Comment text (max 5000 chars)"),
    },
    async (params) => {
      try {
        if (!hasApi()) return fail("chapter_comment requires API_BASE_URL.");
        const wallet = getWalletClient();
        const address = wallet.account!.address;
        const ts = Math.floor(Date.now() / 1000);
        const message = `Comment on chapter ${params.chapterId} at ${ts}: ${params.content}`;
        const signature = await wallet.signMessage({ account: wallet.account!, message });

        const result = await apiPost<{ id: number }>(
          `/api/chapters/${params.chapterId}/comments`,
          { address, content: params.content, timestamp: ts, signature },
        );

        if (result.status === 201 && result.body?.id) {
          return ok(`Comment posted (id=${result.body.id}) on Chapter #${params.chapterId}.`);
        }
        return fail(`Backend rejected comment (status ${result.status})`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatEther, parseEther } from "viem";
import { z } from "zod";

import { config } from "../config.js";
import { tipChapter, tipNovel } from "../shared/index.js";
import { getPublicClient, getWalletClient } from "../utils/client.js";
import { fail, ok, sanitizeError } from "../utils/response.js";

export function registerTipTools(server: McpServer): void {
  // ── tip_novel ──
  server.tool(
    "tip_novel",
    "Tip a novel. The full amount goes to the prize pool.",
    {
      novelId: z.number().describe("Novel ID"),
      value: z.string().describe("Tip amount in ETH"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const amount = parseEther(params.value);
        const hash = await tipNovel(wallet, {
          id: BigInt(params.novelId),
          value: amount,
          prizePool: config.prizePool,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(
          `Tipped Novel #${params.novelId} with ${formatEther(amount)} ETH.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
      }
    },
  );

  // ── tip_chapter ──
  server.tool(
    "tip_chapter",
    "Tip a chapter. 50% goes to the author, 50% to the prize pool.",
    {
      chapterId: z.number().describe("Chapter ID"),
      value: z.string().describe("Tip amount in ETH"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const amount = parseEther(params.value);
        const hash = await tipChapter(wallet, {
          id: BigInt(params.chapterId),
          value: amount,
          prizePool: config.prizePool,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(
          `Tipped Chapter #${params.chapterId} with ${formatEther(amount)} ETH.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
      }
    },
  );
}

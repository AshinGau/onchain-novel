import { type PublicClient, type Transport, type Chain } from "viem";
import { novelCoreAbi } from "../abi/index.js";
import { config } from "../config.js";

export interface ChapterLink {
  chapterId: bigint;
  contentHash: `0x${string}`;
  author: `0x${string}`;
  round: number;
  epoch: number;
}

/**
 * Trace the parentId chain from a given chapter back to genesis (parentId == 0).
 * Returns an array of ChapterLink objects from genesis to the given chapter.
 *
 * @param publicClient - viem public client
 * @param chapterId - Starting chapter ID to trace back from
 * @returns Array of chapter links, ordered genesis-first
 */
export async function traceCanonChain(
  publicClient: PublicClient<Transport, Chain>,
  chapterId: bigint
): Promise<ChapterLink[]> {
  const chain: ChapterLink[] = [];
  let currentId = chapterId;

  while (currentId !== 0n) {
    const chapter = (await publicClient.readContract({
      address: config.novelCoreAddress,
      abi: novelCoreAbi,
      functionName: "getChapter",
      args: [currentId],
    })) as {
      id: bigint;
      novelId: bigint;
      parentId: bigint;
      author: `0x${string}`;
      contentHash: `0x${string}`;
      declaredLength: bigint;
      round: number;
      epoch: number;
      voteCount: bigint;
      isWorldLine: boolean;
      isCanon: boolean;
    };

    chain.unshift({
      chapterId: chapter.id,
      contentHash: chapter.contentHash,
      author: chapter.author,
      round: chapter.round,
      epoch: chapter.epoch,
    });

    currentId = chapter.parentId;
  }

  return chain;
}

/**
 * Assemble story text from a chain of chapter links.
 * This is a placeholder that would fetch content from IPFS/Arweave in production.
 *
 * @param chain - Array of chapter links from traceCanonChain
 * @returns Formatted text with content hash placeholders
 */
export function assembleStoryText(chain: ChapterLink[]): string {
  const parts = chain.map((link, index) => {
    const label =
      link.round === 0
        ? "Genesis"
        : `Epoch ${link.epoch}, Round ${link.round}`;
    return [
      `--- Chapter ${index + 1} (${label}) ---`,
      `Content Hash: ${link.contentHash}`,
      `Author: ${link.author}`,
      `[Content would be fetched from IPFS/Arweave using the content hash above]`,
      "",
    ].join("\n");
  });

  return parts.join("\n");
}

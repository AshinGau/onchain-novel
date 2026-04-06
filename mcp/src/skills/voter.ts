import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  keccak256,
  encodePacked,
  parseEther,
  formatEther,
  toHex,
} from "viem";
import { novelCoreAbi, votingEngineAbi } from "../abi/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient, getWalletAddress } from "../utils/wallet.js";
import { computeVotingRoundId } from "../utils/voting-round-id.js";
import { traceCanonChain, assembleStoryText } from "../utils/content-bridge.js";
import { hasApi, apiFetch } from "../utils/api-client.js";
import { fetchRules, formatRulesForVoter } from "../utils/rules-fetcher.js";
import { getVoterCreativityGuidance } from "../utils/creativity.js";

/**
 * In-memory salt storage for commit-reveal flow.
 * In production, this should be persisted to disk or a database.
 */
const saltStore = new Map<
  string,
  { salt: `0x${string}`; candidateId: bigint; votingRoundId: bigint }
>();

function saltKey(novelId: bigint, votingRoundId: bigint, address?: string): string {
  const addr = address || getWalletAddress();
  return `${novelId}-${votingRoundId}-${addr.toLowerCase()}`;
}

export function registerVoterSkills(server: McpServer): void {
  server.tool(
    "voter_get_context",
    "Voter Skill: Fetch all candidates for a voting round with their chapter details and story context. When API is configured, includes full content text for informed evaluation.",
    {
      novelId: z.number().describe("Novel ID"),
      epoch: z.number().describe("Current epoch number"),
      round: z.number().describe("Current round number"),
      isEpoch: z.boolean().default(false).describe("Whether this is an epoch voting round"),
    },
    async (params) => {
      try {
        const votingRoundId = computeVotingRoundId(
          BigInt(params.novelId),
          params.epoch,
          params.round,
          params.isEpoch
        );

        // ── API path: content text + comment counts ──
        if (hasApi()) {
          // Get candidates from chain (no API equivalent for votingRoundId lookup)
          const publicClient = getPublicClient();
          const candidates = (await publicClient.readContract({
            address: config.votingEngineAddress,
            abi: votingEngineAbi,
            functionName: "getCandidates",
            args: [BigInt(params.novelId), votingRoundId],
          })) as bigint[];

          if (candidates.length === 0) {
            return { content: [{ type: "text" as const, text: `No candidates found. The voting round may not be initialized yet.` }] };
          }

          const candidateContexts: string[] = [];
          for (const candidateId of candidates) {
            // Get chapter detail with content
            const ch = await apiFetch<{
              id: string; author: string; content_text: string | null; declared_length: string;
              parent_id: string; vote_count: string; content_hash: string;
            }>(`/api/chapters/${candidateId}`);

            // Get story chain with content
            const ctxData = await apiFetch<{ ancestors: { id: string; author: string; chapter_index: number; content_text: string | null; is_canon: boolean }[] }>(
              `/api/chapters/${candidateId}/context`
            );

            const storyParts = ctxData.ancestors.map((anc) => {
              const label = anc.chapter_index === 0 ? "Genesis" : `Chapter ${anc.chapter_index}`;
              const body = anc.content_text || "[Content not available]";
              return `  [${label}] by ${anc.author}${anc.is_canon ? " [Canon]" : ""}:\n  ${body}`;
            });

            candidateContexts.push(
              [
                `--- Candidate: Chapter #${candidateId} ---`,
                `Author: ${ch.author}`,
                `Length: ${ch.declared_length} bytes`,
                `Parent: Chapter #${ch.parent_id}`,
                ``,
                `Story chain (${ctxData.ancestors.length} chapters):`,
                ...storyParts,
              ].join("\n")
            );
          }

          // Fetch rules and creativity guidance
          const rules = await fetchRules(params.novelId);
          const rulesSection = formatRulesForVoter(rules);
          const votingPref = getVoterCreativityGuidance();

          const context = [
            `# Voting Context for Novel #${params.novelId}`,
            `Voting Round ID: ${votingRoundId}`,
            `Type: ${params.isEpoch ? "Epoch" : "Round"} Vote`,
            `Epoch: ${params.epoch}, Round: ${params.round}`,
            ``,
            rulesSection,
            ``,
            votingPref,
            ``,
            `## Candidates (${candidates.length})`,
            ``,
            ...candidateContexts,
            ``,
            `## Instructions`,
            `1. Evaluate each candidate based on story quality, creativity, and coherence`,
            `2. Use voter_cast_vote to commit your vote (this generates a salt automatically)`,
            `3. After the commit phase ends, use voter_reveal to reveal your vote`,
          ].filter(Boolean).join("\n");

          return { content: [{ type: "text" as const, text: context }] };
        }

        // ── Fallback: chain-only (no content text) ──
        const publicClient = getPublicClient();

        const candidates = (await publicClient.readContract({
          address: config.votingEngineAddress,
          abi: votingEngineAbi,
          functionName: "getCandidates",
          args: [BigInt(params.novelId), votingRoundId],
        })) as bigint[];

        if (candidates.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No candidates found. The voting round may not be initialized yet.`,
              },
            ],
          };
        }

        // Fetch each candidate's chapter details and story chain
        const candidateContexts: string[] = [];
        for (const candidateId of candidates) {
          const chapter = (await publicClient.readContract({
            address: config.novelCoreAddress,
            abi: novelCoreAbi,
            functionName: "getChapter",
            args: [candidateId],
          })) as {
            id: bigint;
            parentId: bigint;
            author: string;
            contentHash: string;
            declaredLength: bigint;
          };

          const chain = await traceCanonChain(publicClient, candidateId);

          candidateContexts.push(
            [
              `--- Candidate: Chapter #${candidateId} ---`,
              `Author: ${chapter.author}`,
              `Content Hash: ${chapter.contentHash}`,
              `Length: ${chapter.declaredLength} bytes`,
              `Parent: Chapter #${chapter.parentId}`,
              `Story chain (${chain.length} chapters):`,
              assembleStoryText(chain),
            ].join("\n")
          );
        }

        // Fetch rules and creativity guidance
        const rules = await fetchRules(params.novelId, publicClient);
        const rulesSection = formatRulesForVoter(rules);
        const votingPref = getVoterCreativityGuidance();

        const context = [
          `# Voting Context for Novel #${params.novelId}`,
          `Voting Round ID: ${votingRoundId}`,
          `Type: ${params.isEpoch ? "Epoch" : "Round"} Vote`,
          `Epoch: ${params.epoch}, Round: ${params.round}`,
          ``,
          rulesSection,
          ``,
          votingPref,
          ``,
          `## Candidates (${candidates.length})`,
          ``,
          ...candidateContexts,
          ``,
          `## Instructions`,
          `1. Evaluate each candidate based on story quality, creativity, and coherence`,
          `2. Use voter_cast_vote to commit your vote (this generates a salt automatically)`,
          `3. After the commit phase ends, use voter_reveal to reveal your vote`,
        ].filter(Boolean).join("\n");

        return { content: [{ type: "text" as const, text: context }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get voting context: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "voter_cast_vote",
    "Voter Skill: Commit a vote for a candidate. Automatically generates a random salt and stores it for later reveal. Stakes ETH for vote weight.",
    {
      novelId: z.number().describe("Novel ID"),
      epoch: z.number().optional().describe("Epoch number (auto-detected from chain if omitted)"),
      round: z.number().optional().describe("Round number (auto-detected from chain if omitted)"),
      isEpoch: z.boolean().default(false).describe("Whether this is an epoch voting round"),
      candidateId: z.number().describe("Chapter ID to vote for"),
      stakeEth: z.string().describe("ETH to stake for vote weight (e.g. '0.01')"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        // Auto-detect epoch/round from chain if not provided
        let epoch = params.epoch;
        let round = params.round;
        if (epoch == null || round == null) {
          const novel = (await publicClient.readContract({
            address: config.novelCoreAddress,
            abi: novelCoreAbi,
            functionName: "getNovel",
            args: [BigInt(params.novelId)],
          })) as { currentRound: number; currentEpoch: number };
          epoch = epoch ?? novel.currentEpoch;
          round = round ?? novel.currentRound;
        }

        const votingRoundId = computeVotingRoundId(
          BigInt(params.novelId),
          epoch,
          round,
          params.isEpoch
        );

        // Generate random salt
        const saltBytes = new Uint8Array(32);
        crypto.getRandomValues(saltBytes);
        const salt = toHex(saltBytes) as `0x${string}`;

        // Compute commit hash
        const commitHash = keccak256(
          encodePacked(
            ["uint256", "bytes32"],
            [BigInt(params.candidateId), salt]
          )
        );

        // Store salt for later reveal
        const key = saltKey(BigInt(params.novelId), votingRoundId);
        saltStore.set(key, {
          salt,
          candidateId: BigInt(params.candidateId),
          votingRoundId,
        });

        const hash = await walletClient.writeContract({
          address: config.votingEngineAddress,
          abi: votingEngineAbi,
          functionName: "commitVote",
          args: [BigInt(params.novelId), votingRoundId, commitHash],
          value: parseEther(params.stakeEth),
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Vote committed successfully!`,
                `Candidate: Chapter #${params.candidateId}`,
                `Commit Hash: ${commitHash}`,
                `Stake: ${params.stakeEth} ETH`,
                `Salt: ${salt}`,
                `Voting Round ID: ${votingRoundId}`,
                `Transaction: ${hash}`,
                `Block: ${receipt.blockNumber}`,
                ``,
                `The salt has been stored in memory. Use voter_reveal to reveal after commit phase ends.`,
                `If the server restarts, you will need to reveal manually with commit_vote using the salt above.`,
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to cast vote: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "voter_reveal",
    "Voter Skill: Reveal a previously committed vote using the stored salt. Must be called during the reveal phase.",
    {
      novelId: z.number().describe("Novel ID"),
      epoch: z.number().optional().describe("Epoch number (auto-detected from chain if omitted)"),
      round: z.number().optional().describe("Round number (auto-detected from chain if omitted)"),
      isEpoch: z.boolean().default(false).describe("Whether this is an epoch voting round"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        // Auto-detect epoch/round from chain if not provided
        let epoch = params.epoch;
        let round = params.round;
        if (epoch == null || round == null) {
          const novel = (await publicClient.readContract({
            address: config.novelCoreAddress,
            abi: novelCoreAbi,
            functionName: "getNovel",
            args: [BigInt(params.novelId)],
          })) as { currentRound: number; currentEpoch: number };
          epoch = epoch ?? novel.currentEpoch;
          round = round ?? novel.currentRound;
        }

        const votingRoundId = computeVotingRoundId(
          BigInt(params.novelId),
          epoch,
          round,
          params.isEpoch
        );

        const key = saltKey(BigInt(params.novelId), votingRoundId);
        const stored = saltStore.get(key);

        if (!stored) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No stored salt found for this voting round. The server may have restarted since commit. Use reveal_vote tool manually with your saved salt and candidateId.`,
              },
            ],
            isError: true,
          };
        }

        const hash = await walletClient.writeContract({
          address: config.votingEngineAddress,
          abi: votingEngineAbi,
          functionName: "revealVote",
          args: [
            BigInt(params.novelId),
            votingRoundId,
            stored.candidateId,
            stored.salt,
          ],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // Clean up stored salt
        saltStore.delete(key);

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Vote revealed successfully!`,
                `Candidate: Chapter #${stored.candidateId}`,
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
              text: `Failed to reveal vote: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

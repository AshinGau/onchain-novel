import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseEther, formatEther } from "viem";
import { novelCoreAbi } from "../abi/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient } from "../utils/wallet.js";

const ROUND_PHASE_NAMES = ["Submitting", "Committing", "Revealing", "Settling"];
const EPOCH_PHASE_NAMES = ["Rounds", "Committing", "Revealing", "Settling"];

export function registerNovelTools(server: McpServer): void {
  server.tool(
    "create_novel",
    "Create a new collaborative novel on-chain. Requires genesis content hash(es) and novel configuration. Send ETH to fund the initial prize pool.",
    {
      minChapterLength: z.number().describe("Minimum content bytes per chapter"),
      maxChapterLength: z.number().describe("Maximum content bytes per chapter"),
      roundMinDuration: z.number().describe("Minimum round duration in seconds"),
      roundMinSubmissions: z.number().describe("Minimum submissions before round can close (must be >= worldLineCount)"),
      worldLineCount: z.number().describe("Number of parallel world lines to keep per round"),
      roundsPerEpoch: z.number().describe("Rounds per epoch before epoch voting"),
      prizeReleaseRate: z.number().describe("Epoch release rate in basis points (e.g. 3000 = 30%)"),
      voterRewardRate: z.number().describe("Voter reward rate in basis points (max 2000 = 20%)"),
      commitDuration: z.number().describe("Commit phase duration in seconds"),
      revealDuration: z.number().describe("Reveal phase duration in seconds"),
      stakeAmount: z.string().describe("Required stake per chapter submission in ETH (e.g. '0.01')"),
      pollutionRounds: z.number().describe("Consecutive rounds for pollution tracking"),
      pollutionThreshold: z.number().describe("Bottom X percentile counts as pollution (e.g. 20)"),
      contentBaseUrl: z.string().default("").describe("Base URL for content storage (e.g. 'https://arweave.net/')"),
      genesisContentHashes: z.array(z.string()).describe("Array of bytes32 content hashes for genesis chapters"),
      genesisLengths: z.array(z.number()).describe("Array of declared content lengths for genesis chapters"),
      initialPrizeEth: z.string().optional().describe("Initial prize pool deposit in ETH (e.g. '1.0')"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const novelConfig = {
          minChapterLength: BigInt(params.minChapterLength),
          maxChapterLength: BigInt(params.maxChapterLength),
          roundMinDuration: BigInt(params.roundMinDuration),
          roundMinSubmissions: params.roundMinSubmissions,
          worldLineCount: params.worldLineCount,
          roundsPerEpoch: params.roundsPerEpoch,
          prizeReleaseRate: params.prizeReleaseRate,
          voterRewardRate: params.voterRewardRate,
          commitDuration: BigInt(params.commitDuration),
          revealDuration: BigInt(params.revealDuration),
          stakeAmount: parseEther(params.stakeAmount),
          pollutionRounds: params.pollutionRounds,
          pollutionThreshold: params.pollutionThreshold,
          contentBaseUrl: params.contentBaseUrl,
        };

        const value = params.initialPrizeEth
          ? parseEther(params.initialPrizeEth)
          : 0n;

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "createNovel",
          args: [
            novelConfig,
            params.genesisContentHashes as `0x${string}`[],
            params.genesisLengths.map((l) => BigInt(l)),
          ],
          value,
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Novel created successfully.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}\nStatus: ${receipt.status}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to create novel: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_novel",
    "Get the full state of a novel by ID, including current round/epoch phases and configuration.",
    {
      novelId: z.number().describe("Novel ID to query"),
    },
    async (params) => {
      try {
        const publicClient = getPublicClient();

        const novel = (await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getNovel",
          args: [BigInt(params.novelId)],
        })) as Record<string, unknown>;

        if ((novel as { id: bigint }).id === 0n) {
          return {
            content: [
              { type: "text" as const, text: `Novel ${params.novelId} not found.` },
            ],
          };
        }

        const n = novel as {
          id: bigint;
          creator: string;
          config: {
            minChapterLength: bigint;
            maxChapterLength: bigint;
            roundMinDuration: bigint;
            roundMinSubmissions: number;
            worldLineCount: number;
            roundsPerEpoch: number;
            prizeReleaseRate: number;
            voterRewardRate: number;
            commitDuration: bigint;
            revealDuration: bigint;
            stakeAmount: bigint;
            pollutionRounds: number;
            pollutionThreshold: number;
          };
          currentRound: number;
          currentEpoch: number;
          roundPhase: number;
          epochPhase: number;
          phaseStartTime: bigint;
          genesisChapterCount: number;
          cumulativeCanonChapters: number;
          active: boolean;
          forkSourceNovelId: bigint;
          forkSourceChapterId: bigint;
        };

        const info = [
          `Novel #${n.id}`,
          `Creator: ${n.creator}`,
          `Active: ${n.active}`,
          `Current Round: ${n.currentRound} (${ROUND_PHASE_NAMES[n.roundPhase]})`,
          `Current Epoch: ${n.currentEpoch} (${EPOCH_PHASE_NAMES[n.epochPhase]})`,
          `Phase Start: ${new Date(Number(n.phaseStartTime) * 1000).toISOString()}`,
          `Genesis Chapters: ${n.genesisChapterCount}`,
          `Cumulative Canon: ${n.cumulativeCanonChapters}`,
          `Stake: ${formatEther(n.config.stakeAmount)} ETH`,
          `World Lines: ${n.config.worldLineCount}`,
          `Rounds/Epoch: ${n.config.roundsPerEpoch}`,
          `Min Submissions: ${n.config.roundMinSubmissions}`,
          n.forkSourceNovelId > 0n
            ? `Forked from Novel #${n.forkSourceNovelId} Chapter #${n.forkSourceChapterId}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");

        return { content: [{ type: "text" as const, text: info }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get novel: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_active_world_lines",
    "Get the currently active world line chapter IDs for a novel. These are the branches available for continuation.",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        const publicClient = getPublicClient();

        const worldLines = (await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getActiveWorldLines",
          args: [BigInt(params.novelId)],
        })) as bigint[];

        if (worldLines.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No active world lines for novel ${params.novelId}.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Active world lines for Novel #${params.novelId}:\n${worldLines.map((id) => `  - Chapter #${id}`).join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get world lines: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "fork_novel",
    "Create a new independent novel by forking from a rejected branch of an existing novel.",
    {
      originalNovelId: z.number().describe("Source novel ID"),
      branchChapterId: z.number().describe("Chapter ID of the rejected branch to fork from"),
      minChapterLength: z.number().describe("Minimum content bytes per chapter"),
      maxChapterLength: z.number().describe("Maximum content bytes per chapter"),
      roundMinDuration: z.number().describe("Minimum round duration in seconds"),
      roundMinSubmissions: z.number().describe("Minimum submissions before round can close"),
      worldLineCount: z.number().describe("Number of world lines to keep per round"),
      roundsPerEpoch: z.number().describe("Rounds per epoch"),
      prizeReleaseRate: z.number().describe("Epoch release rate in basis points"),
      voterRewardRate: z.number().describe("Voter reward rate in basis points"),
      commitDuration: z.number().describe("Commit phase duration in seconds"),
      revealDuration: z.number().describe("Reveal phase duration in seconds"),
      stakeAmount: z.string().describe("Required stake per submission in ETH"),
      pollutionRounds: z.number().describe("Pollution tracking window"),
      pollutionThreshold: z.number().describe("Bottom percentile for pollution"),
      initialPrizeEth: z.string().optional().describe("Initial prize pool in ETH"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const novelConfig = {
          minChapterLength: BigInt(params.minChapterLength),
          maxChapterLength: BigInt(params.maxChapterLength),
          roundMinDuration: BigInt(params.roundMinDuration),
          roundMinSubmissions: params.roundMinSubmissions,
          worldLineCount: params.worldLineCount,
          roundsPerEpoch: params.roundsPerEpoch,
          prizeReleaseRate: params.prizeReleaseRate,
          voterRewardRate: params.voterRewardRate,
          commitDuration: BigInt(params.commitDuration),
          revealDuration: BigInt(params.revealDuration),
          stakeAmount: parseEther(params.stakeAmount),
          pollutionRounds: params.pollutionRounds,
          pollutionThreshold: params.pollutionThreshold,
          contentBaseUrl: "", // Inherited from source novel (overridden by contract)
        };

        const value = params.initialPrizeEth
          ? parseEther(params.initialPrizeEth)
          : 0n;

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "forkNovel",
          args: [
            BigInt(params.originalNovelId),
            BigInt(params.branchChapterId),
            novelConfig,
          ],
          value,
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Novel forked successfully from Novel #${params.originalNovelId} Chapter #${params.branchChapterId}.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fork novel: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "complete_novel",
    "Deactivate a novel (owner only). Must be in Submitting phase.",
    {
      novelId: z.number().describe("Novel ID to complete"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "completeNovel",
          args: [BigInt(params.novelId)],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Novel #${params.novelId} completed.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to complete novel: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

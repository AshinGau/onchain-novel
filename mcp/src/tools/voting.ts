import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { keccak256, encodePacked, parseEther, formatEther } from "viem";
import { votingEngineAbi } from "../abi/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient, getWalletAddress } from "../utils/wallet.js";
import { computeVotingRoundId } from "../utils/voting-round-id.js";

export function registerVotingTools(server: McpServer): void {
  server.tool(
    "commit_vote",
    "Commit a vote in the commit-reveal voting scheme. Creates a hash commitment of (candidateId, salt). Stake ETH for vote weight (0.001 ETH = 1 vote). Save the salt to reveal later!",
    {
      novelId: z.number().describe("Novel ID"),
      votingRoundId: z.string().describe("Voting round ID (uint256 as string)"),
      candidateId: z.number().describe("Chapter ID to vote for"),
      salt: z.string().describe("Random bytes32 salt for commit-reveal (save this for reveal!)"),
      stakeEth: z.string().describe("ETH to stake for vote weight (e.g. '0.01')"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const commitHash = keccak256(
          encodePacked(
            ["uint256", "bytes32"],
            [BigInt(params.candidateId), params.salt as `0x${string}`]
          )
        );

        const hash = await walletClient.writeContract({
          address: config.votingEngineAddress,
          abi: votingEngineAbi,
          functionName: "commitVote",
          args: [
            BigInt(params.novelId),
            BigInt(params.votingRoundId),
            commitHash,
          ],
          value: parseEther(params.stakeEth),
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Vote committed successfully.\nCommit Hash: ${commitHash}\nStake: ${params.stakeEth} ETH\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}\n\nIMPORTANT: Save your salt (${params.salt}) and candidateId (${params.candidateId}) to reveal later!`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to commit vote: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "reveal_vote",
    "Reveal a previously committed vote by providing the candidateId and salt used during commit.",
    {
      novelId: z.number().describe("Novel ID"),
      votingRoundId: z.string().describe("Voting round ID (uint256 as string)"),
      candidateId: z.number().describe("Chapter ID that was voted for"),
      salt: z.string().describe("The salt used during commit"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.votingEngineAddress,
          abi: votingEngineAbi,
          functionName: "revealVote",
          args: [
            BigInt(params.novelId),
            BigInt(params.votingRoundId),
            BigInt(params.candidateId),
            params.salt as `0x${string}`,
          ],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Vote revealed successfully.\nCandidate: #${params.candidateId}\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
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

  server.tool(
    "claim_voting_reward",
    "Claim voting reward (stake refund + unrevealed stake share + accuracy reward) after a round has been tallied.",
    {
      novelId: z.number().describe("Novel ID"),
      votingRoundId: z.string().describe("Voting round ID (uint256 as string)"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.votingEngineAddress,
          abi: votingEngineAbi,
          functionName: "claimVotingReward",
          args: [BigInt(params.novelId), BigInt(params.votingRoundId)],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Voting reward claimed.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to claim voting reward: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "sweep_unrevealed",
    "Sweep unrevealed stakes from a tallied voting round. Confiscated stakes are redistributed to revealed voters.",
    {
      novelId: z.number().describe("Novel ID"),
      votingRoundId: z.string().describe("Voting round ID (uint256 as string)"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.votingEngineAddress,
          abi: votingEngineAbi,
          functionName: "sweepUnrevealedStakes",
          args: [BigInt(params.novelId), BigInt(params.votingRoundId)],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Unrevealed stakes swept.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to sweep: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_candidates",
    "Get all candidate chapter IDs for a voting round.",
    {
      novelId: z.number().describe("Novel ID"),
      votingRoundId: z.string().describe("Voting round ID (uint256 as string)"),
    },
    async (params) => {
      try {
        const publicClient = getPublicClient();

        const candidates = (await publicClient.readContract({
          address: config.votingEngineAddress,
          abi: votingEngineAbi,
          functionName: "getCandidates",
          args: [BigInt(params.novelId), BigInt(params.votingRoundId)],
        })) as bigint[];

        if (candidates.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No candidates found for this voting round. The round may not be initialized yet.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Candidates for voting round:\n${candidates.map((id) => `  - Chapter #${id}`).join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get candidates: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "compute_voting_round_id",
    "Compute the voting round ID from novel parameters. Matches the on-chain keccak256(abi.encodePacked(novelId, epoch, round, isEpoch)).",
    {
      novelId: z.number().describe("Novel ID"),
      epoch: z.number().describe("Epoch number"),
      round: z.number().describe("Round number"),
      isEpoch: z.boolean().describe("Whether this is an epoch voting round"),
    },
    async (params) => {
      const id = computeVotingRoundId(
        BigInt(params.novelId),
        params.epoch,
        params.round,
        params.isEpoch
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Voting Round ID: ${id.toString()}\n(Novel #${params.novelId}, Epoch ${params.epoch}, Round ${params.round}, isEpoch: ${params.isEpoch})`,
          },
        ],
      };
    }
  );
}

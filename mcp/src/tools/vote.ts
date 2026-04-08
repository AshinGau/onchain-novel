import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatEther } from "viem";
import {
  commitVote,
  revealVote,
  startRound,
  settleRound,
  getNovel,
  getRoundData,
  computeCommitHash,
  toBytes32Salt,
} from "../shared/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient } from "../utils/client.js";
import { hasApi, apiGet } from "../utils/api.js";
import { ok, fail } from "../utils/response.js";

export function registerVoteTools(server: McpServer): void {
  // ── vote_start ──
  server.tool(
    "vote_start",
    "Start a new voting round (keeper action). DFS generates candidate set automatically.",
    { novelId: z.number().describe("Novel ID") },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const hash = await startRound(wallet, BigInt(params.novelId), config.novelCore);
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(`Round started for Novel #${params.novelId}.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── vote_commit ──
  server.tool(
    "vote_commit",
    "Commit a vote for a candidate chapter. The salt is a memorable string you must remember for reveal.",
    {
      novelId: z.number().describe("Novel ID"),
      candidateId: z.number().describe("Candidate chapter ID to vote for"),
      salt: z.string().describe("A memorable salt string (you MUST remember this for reveal)"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const saltBytes = toBytes32Salt(params.salt);
        const hash32 = computeCommitHash(BigInt(params.candidateId), saltBytes);

        // Get vote stake from novel config
        const novel = (await getNovel(pub, BigInt(params.novelId), config.novelCore)) as any;
        const stake = novel.config.voteStake as bigint;

        const txHash = await commitVote(wallet, {
          novelId: BigInt(params.novelId),
          commitHash: hash32,
          value: stake,
          novelCore: config.novelCore,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
        return ok(
          `Vote committed.\nStake: ${formatEther(stake)} ETH\nSalt: "${params.salt}" (REMEMBER THIS)\nTx: ${txHash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── vote_reveal ──
  server.tool(
    "vote_reveal",
    "Reveal a previously committed vote.",
    {
      novelId: z.number().describe("Novel ID"),
      candidateId: z.number().describe("Candidate chapter ID you voted for"),
      salt: z.string().describe("The same salt string used during commit"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const saltBytes = toBytes32Salt(params.salt);
        const txHash = await revealVote(wallet, {
          novelId: BigInt(params.novelId),
          candidateId: BigInt(params.candidateId),
          salt: saltBytes,
          novelCore: config.novelCore,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
        return ok(`Vote revealed.\nTx: ${txHash}\nBlock: ${receipt.blockNumber}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── vote_settle ──
  server.tool(
    "vote_settle",
    "Settle the current voting round (keeper action). Determines winners and distributes rewards.",
    { novelId: z.number().describe("Novel ID") },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const hash = await settleRound(wallet, BigInt(params.novelId), config.novelCore);
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(`Round settled for Novel #${params.novelId}.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── vote_candidates ──
  server.tool(
    "vote_candidates",
    "Get the candidate chapters for the current voting round.",
    { novelId: z.number().describe("Novel ID") },
    async (params) => {
      try {
        if (hasApi()) {
          const data = await apiGet<{
            candidates: { id: string; author: string; depth: number; vote_count: string }[];
          }>(`/api/novels/${params.novelId}/candidates`);
          if (data.candidates.length === 0) return ok("No candidates in current round.");
          const lines = data.candidates.map(
            (c) => `  #${c.id} (depth ${c.depth}) by ${c.author} — ${c.vote_count} votes`,
          );
          return ok(`Candidates for Novel #${params.novelId}:\n${lines.join("\n")}`);
        }

        const pub = getPublicClient();
        const novel = (await getNovel(pub, BigInt(params.novelId), config.novelCore)) as any;
        const round = await getRoundData(pub, BigInt(params.novelId), novel.currentRound, config.novelCore);
        const rd = round as any;
        if (!rd.candidates || rd.candidates.length === 0) return ok("No candidates.");
        const lines = rd.candidates.map((id: bigint, i: number) => `  #${id}${rd.candidateIsEligible?.[i] ? "" : " [ineligible]"}`);
        return ok(`Candidates (Round ${novel.currentRound}):\n${lines.join("\n")}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );
}

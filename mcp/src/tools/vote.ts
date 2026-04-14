import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatEther, toHex } from "viem";
import { randomBytes } from "node:crypto";
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
import { hasApi, apiGet, apiPost } from "../utils/api.js";
import { saveVoteSalt, getVoteSalt, getStorePath } from "../utils/vote-store.js";
import { ok, fail } from "../utils/response.js";

/** Generate a fresh 32-byte random salt as 0x-prefixed hex */
function generateSalt(): `0x${string}` {
  return toHex(randomBytes(32));
}

export function registerVoteTools(server: McpServer): void {
  // ── vote_start ──
  server.tool(
    "vote_start",
    "Start a new voting round (keeper action). DFS generates candidate set automatically. Requires every current world line to have at least one continuation chapter (N >= worldLineCount). Reverts with InsufficientCandidates otherwise.",
    { novelId: z.number().describe("Novel ID") },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const hash = await startRound(wallet, BigInt(params.novelId), config.roundManager);
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
    "Commit a vote. If `salt` is omitted, a random 32-byte salt is generated, " +
      "saved locally as backup, and submitted to the backend for keeper-assisted reveal.",
    {
      novelId: z.number().describe("Novel ID"),
      candidateId: z.number().describe("Candidate chapter ID to vote for"),
      salt: z.string().optional().describe("Optional memorable salt string. If omitted, generated automatically."),
      keeperAssisted: z.boolean().default(true).describe("Submit plaintext to backend so keeper can auto-reveal"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const voter = wallet.account!.address;

        // Auto-generate fresh random salt when not provided
        const saltBytes: `0x${string}` = params.salt ? toBytes32Salt(params.salt) : generateSalt();
        const hash32 = computeCommitHash(BigInt(params.candidateId), saltBytes);

        // Get vote stake + current round from novel config
        const novel = (await getNovel(pub, BigInt(params.novelId), config.novelCore)) as any;
        const stake = novel.config.voteStake as bigint;
        const currentRound = Number(novel.currentRound ?? 0);

        const txHash = await commitVote(wallet, {
          novelId: BigInt(params.novelId),
          commitHash: hash32,
          value: stake,
          roundManager: config.roundManager,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash: txHash });

        // Persist salt to local backup
        const lines = [
          `Vote committed.`,
          `Stake: ${formatEther(stake)} ETH`,
          `Salt:  ${saltBytes}`,
          `Tx:    ${txHash}`,
          `Block: ${receipt.blockNumber}`,
        ];

        if (currentRound > 0) {
          saveVoteSalt({
            novelId: params.novelId.toString(),
            round: currentRound,
            candidateId: params.candidateId.toString(),
            salt: saltBytes,
            voter,
          });
          lines.push(`Salt saved to ${getStorePath()}`);
        }

        // Best-effort keeper-assisted reveal submission
        if (params.keeperAssisted && currentRound > 0 && hasApi()) {
          const ts = Math.floor(Date.now() / 1000);
          const message =
            `Submit vote on novel ${params.novelId} round ${currentRound} for candidate ${params.candidateId} at ${ts}`;
          const signature = await wallet.signMessage({ account: wallet.account!, message });

          const result = await apiPost("/api/votes/submit", {
            address: voter,
            novelId: params.novelId,
            round: currentRound,
            candidateId: params.candidateId,
            salt: saltBytes,
            timestamp: ts,
            signature,
          });

          if (result.status === 201) {
            lines.push(`Keeper will auto-reveal during the reveal phase.`);
          } else if (result.status === 503) {
            lines.push(`Keeper-assisted reveal disabled on backend (you must reveal manually).`);
          } else {
            lines.push(`Backend rejected /api/votes/submit (status ${result.status}); reveal manually.`);
          }
        } else if (params.keeperAssisted && !hasApi()) {
          lines.push(`API_BASE_URL not configured; skipped keeper submission.`);
        }

        return ok(lines.join("\n"));
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── vote_reveal ──
  server.tool(
    "vote_reveal",
    "Reveal a previously committed vote. If `salt` is omitted, falls back to the local backup saved by vote_commit.",
    {
      novelId: z.number().describe("Novel ID"),
      candidateId: z.number().describe("Candidate chapter ID you voted for"),
      salt: z.string().optional().describe("Optional salt — falls back to local store"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const voter = wallet.account!.address;

        let saltBytes: `0x${string}`;
        if (params.salt) {
          saltBytes = toBytes32Salt(params.salt);
        } else {
          const novel = (await getNovel(pub, BigInt(params.novelId), config.novelCore)) as any;
          const currentRound = Number(novel.currentRound ?? 0);
          const stored = getVoteSalt(BigInt(params.novelId), currentRound, voter);
          if (!stored) {
            return fail(`No salt provided and no local backup for round ${currentRound}.`);
          }
          saltBytes = stored.salt;
        }

        const txHash = await revealVote(wallet, {
          novelId: BigInt(params.novelId),
          candidateId: BigInt(params.candidateId),
          salt: saltBytes,
          roundManager: config.roundManager,
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
        const hash = await settleRound(wallet, BigInt(params.novelId), config.roundManager);
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

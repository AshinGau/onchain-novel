import { randomBytes } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatEther, toHex } from "viem";
import { z } from "zod";

import { config } from "../config.js";
import {
  buildPathToAnchor,
  commitVote,
  computeCommitHash,
  getNovel,
  getRoundData,
  nominateCandidate,
  revealVote,
  settleRound,
  startRound,
  toBytes32Salt,
} from "../shared/index.js";
import { apiGet, apiPost, hasApi } from "../utils/api.js";
import { getPublicClient, getWalletClient } from "../utils/client.js";
import { fail, ok } from "../utils/response.js";
import { getStorePath, getVoteSalt, saveVoteSalt } from "../utils/vote-store.js";

/** Generate a fresh 32-byte random salt as 0x-prefixed hex */
function generateSalt(): `0x${string}` {
  return toHex(randomBytes(32));
}

export function registerVoteTools(server: McpServer): void {
  // ── vote_start ──
  server.tool(
    "vote_start",
    "Start a new voting round (keeper / owner only). Caller must supply `leaves`: leaf chapter IDs " +
      "(one per current world line, deepest leaves preferred). Each must have no children.",
    {
      novelId: z.number().describe("Novel ID"),
      leaves: z
        .array(z.number())
        .describe("Leaf chapter IDs (>= worldLineCount entries, true tree leaves)"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const hash = await startRound(wallet, {
          novelId: BigInt(params.novelId),
          leaves: params.leaves.map((x) => BigInt(x)),
          roundManager: config.roundManager,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(
          `Round started for Novel #${params.novelId}.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
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
      salt: z
        .string()
        .optional()
        .describe("Optional memorable salt string. If omitted, generated automatically."),
      keeperAssisted: z
        .boolean()
        .default(true)
        .describe("Submit plaintext to backend so keeper can auto-reveal"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const voter = wallet.account!.address;

        // Auto-generate fresh random salt when not provided
        const saltBytes: `0x${string}` = params.salt ? toBytes32Salt(params.salt) : generateSalt();
        const hash32 = computeCommitHash(voter, BigInt(params.candidateId), saltBytes);

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
          const message = `Submit vote on novel ${params.novelId} round ${currentRound} for candidate ${params.candidateId} at ${ts}`;
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
            lines.push(
              `Backend rejected /api/votes/submit (status ${result.status}); reveal manually.`,
            );
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
    "Reveal a previously committed vote. Anyone can call revealVote on behalf of a voter — " +
      "only the matching voter address whose commit hash equals keccak(voter, c, s) will succeed. " +
      "If `voter` is omitted, defaults to the connected wallet. If `salt` is omitted, falls back " +
      "to the local backup saved by vote_commit.",
    {
      novelId: z.number().describe("Novel ID"),
      candidateId: z.number().describe("Candidate chapter ID you voted for"),
      salt: z.string().optional().describe("Optional salt — falls back to local store"),
      voter: z.string().optional().describe("Voter address (defaults to connected wallet)"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const voter = (params.voter as `0x${string}` | undefined) ?? wallet.account!.address;

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
          voter,
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
    "Settle the current voting round (keeper / owner, or anyone after timeout). " +
      "Winner reward-author derivation is fully on-chain — no extra args needed.",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const hash = await settleRound(wallet, {
          novelId: BigInt(params.novelId),
          roundManager: config.roundManager,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(
          `Round settled for Novel #${params.novelId}.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  // ── vote_nominate ──
  server.tool(
    "vote_nominate",
    "Nominate a chapter as a candidate for the current round. By default the path proof " +
      "(chapter → current worldLineAncestor) is auto-computed for reward eligibility. " +
      "Pass forfeit=true to nominate an arbitrary chapter with no reward eligibility (empty path).",
    {
      novelId: z.number().describe("Novel ID"),
      chapterId: z.number().describe("Chapter to nominate"),
      forfeit: z
        .boolean()
        .default(false)
        .describe("If true, skip path proof and forfeit reward eligibility"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const novel = (await getNovel(pub, BigInt(params.novelId), config.novelCore)) as any;
        const nominationFee = novel.config.nominationFee as bigint;

        let path: bigint[] = [];
        if (!params.forfeit) {
          const ancestors = (await pub.readContract({
            address: config.novelCore,
            abi: (await import("../shared/abi.js")).novelCoreAbi,
            functionName: "getWorldLineAncestors",
            args: [BigInt(params.novelId)],
          })) as readonly bigint[];
          const proof = await buildPathToAnchor(
            pub,
            config.novelCore,
            BigInt(params.novelId),
            BigInt(params.chapterId),
            ancestors,
          );
          if (!proof || proof.length < 2) {
            return fail(
              `Chapter #${params.chapterId} is not a strict descendant of any current worldLineAncestor. ` +
                `Pass forfeit=true to nominate anyway (no reward eligibility).`,
            );
          }
          path = proof;
        }

        const hash = await nominateCandidate(wallet, {
          novelId: BigInt(params.novelId),
          chapterId: BigInt(params.chapterId),
          path,
          value: nominationFee,
          roundManager: config.roundManager,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(
          `Chapter #${params.chapterId} nominated${params.forfeit ? " (forfeit mode)" : ""}.\n` +
            `Tx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
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
        const round = await getRoundData(
          pub,
          BigInt(params.novelId),
          novel.currentRound,
          config.novelCore,
        );
        const rd = round as any;
        if (!rd.candidates || rd.candidates.length === 0) return ok("No candidates.");
        const lines = rd.candidates.map(
          (id: bigint, i: number) =>
            `  #${id}${rd.candidateIsEligible?.[i] ? "" : " [ineligible]"}`,
        );
        return ok(`Candidates (Round ${novel.currentRound}):\n${lines.join("\n")}`);
      } catch (error) {
        return fail(`Failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );
}

import type { PublicClient } from "viem";
import { parseAbi } from "viem";

import { query } from "../db/index.js";
import { decryptVoteSalt } from "../utils/crypto.js";
import { env } from "../utils/env.js";
import { createLogger } from "../utils/logger.js";
import { keeperWrite } from "./index.js";

const log = createLogger("keeper:reveal");

const revealAbi = parseAbi([
  "function revealVote(uint64 novelId, address voter, uint64 candidateId, bytes32 salt) external",
]);

interface PendingVote {
  novelId: bigint;
  round: number;
  voter: string;
  candidateId: bigint;
  saltEncrypted: string;
}

/**
 * Batch-reveal all `committed` pending votes for a (novelId, round) pair.
 * Marks each as `revealed` on success or `failed` on tx error (most commonly
 * because the user already self-revealed).
 *
 * Caller is the keeper module; should be invoked once per Revealing phase
 * before settleRound.
 */
export async function batchReveal(
  novelId: bigint,
  round: number,
  publicClient: PublicClient,
  keeperAddress: `0x${string}`,
): Promise<{ revealed: number; failed: number }> {
  if (!env.VOTE_ENCRYPTION_KEY) return { revealed: 0, failed: 0 };

  const { rows } = await query(
    "SELECT novel_id, round, voter, candidate_id, salt_encrypted FROM pending_votes WHERE novel_id = $1 AND round = $2 AND status = 'committed'",
    [novelId.toString(), round],
  );

  let revealed = 0;
  let failed = 0;

  for (const r of rows as Array<{
    novel_id: string;
    round: number;
    voter: string;
    candidate_id: string;
    salt_encrypted: string;
  }>) {
    const vote: PendingVote = {
      novelId: BigInt(r.novel_id),
      round: r.round,
      voter: r.voter,
      candidateId: BigInt(r.candidate_id),
      saltEncrypted: r.salt_encrypted,
    };

    let salt: `0x${string}`;
    try {
      salt = decryptVoteSalt(vote.saltEncrypted) as `0x${string}`;
    } catch (err) {
      log.error({ err, voter: `${vote.voter.slice(0, 6)}...` }, "Decrypt failed");
      await query(
        "UPDATE pending_votes SET status = 'failed' WHERE novel_id = $1 AND round = $2 AND voter = $3",
        [vote.novelId.toString(), vote.round, vote.voter],
      );
      failed++;
      continue;
    }

    try {
      if (!env.ROUND_MANAGER_ADDRESS) {
        throw new Error("ROUND_MANAGER_ADDRESS not configured");
      }
      const { request } = await publicClient.simulateContract({
        address: env.ROUND_MANAGER_ADDRESS,
        abi: revealAbi,
        functionName: "revealVote",
        args: [vote.novelId, vote.voter as `0x${string}`, vote.candidateId, salt],
        account: keeperAddress,
      });
      const hash = await keeperWrite(request as any);
      log.info(
        {
          novelId: vote.novelId,
          candidateId: vote.candidateId,
          voter: `${vote.voter.slice(0, 6)}...`,
          hash,
        },
        "revealVote sent",
      );
      await query(
        "UPDATE pending_votes SET status = 'revealed' WHERE novel_id = $1 AND round = $2 AND voter = $3",
        [vote.novelId.toString(), vote.round, vote.voter],
      );
      revealed++;
    } catch (err: any) {
      // Most common cause: user already revealed manually, or commit hash mismatch.
      const name = err?.name ?? "Error";
      const code = err?.code ?? "";
      const maskedVoter = `${vote.voter.slice(0, 6)}...`;
      log.error({ err, voter: maskedVoter, name, code }, "revealVote failed");
      await query(
        "UPDATE pending_votes SET status = 'failed' WHERE novel_id = $1 AND round = $2 AND voter = $3",
        [vote.novelId.toString(), vote.round, vote.voter],
      );
      failed++;
    }
  }

  return { revealed, failed };
}

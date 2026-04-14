import { Command } from "commander";
import { parseEther, toHex } from "viem";
import { randomBytes } from "node:crypto";
import {
  startRound as startRoundTx,
  closeNomination as closeNominationTx,
  closeCommit as closeCommitTx,
  settleRound as settleRoundTx,
  nominateCandidate as nominateCandidateTx,
  commitVote as commitVoteTx,
  revealVote as revealVoteTx,
  claimVotingReward as claimVotingRewardTx,
  computeCommitHash,
  toBytes32Salt,
} from "../shared/index.js";
import { getWalletClient, getContracts, waitForTx } from "../utils/client.js";
import { apiGet, apiPost } from "../utils/api.js";
import { saveVoteSalt, getVoteSalt, getStorePath } from "../utils/vote-store.js";
import { header, kv, success, error, txHash, table, roundPhaseName } from "../utils/format.js";
import chalk from "chalk";

/** Generate a fresh 32-byte random salt as 0x-prefixed hex */
function generateSalt(): `0x${string}` {
  return toHex(randomBytes(32));
}

export function registerVoteCommands(program: Command): void {
  const vote = program.command("vote").description("Voting commands");

  vote
    .command("start <novel-id>")
    .description("Start a new voting round (keeper action). Requires every world line to have >= 1 continuation; otherwise reverts with InsufficientCandidates.")
    .action(async (novelId) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await startRoundTx(client, BigInt(novelId), contracts.roundManager);
        txHash(hash);
        await waitForTx(hash);
        success("Round started");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  vote
    .command("close-nomination <novel-id>")
    .description("Close the nomination phase")
    .action(async (novelId) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await closeNominationTx(client, BigInt(novelId), contracts.roundManager);
        txHash(hash);
        await waitForTx(hash);
        success("Nomination closed");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  vote
    .command("close-commit <novel-id>")
    .description("Close the commit phase")
    .action(async (novelId) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await closeCommitTx(client, BigInt(novelId), contracts.roundManager);
        txHash(hash);
        await waitForTx(hash);
        success("Commit phase closed");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  vote
    .command("nominate <novel-id> <chapter-id>")
    .description("Nominate a chapter as candidate")
    .option("--value <eth>", "nomination fee in ETH")
    .action(async (novelId, chapterId, opts) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();

        let value: bigint;
        if (opts.value) {
          value = parseEther(opts.value);
        } else {
          try {
            const novel = await apiGet<Record<string, unknown>>(`/api/novels/${novelId}`);
            const config = novel.config as Record<string, string>;
            value = BigInt(config.nominationFee ?? "0");
          } catch {
            value = parseEther("0.001");
            console.log(chalk.yellow(`  Could not fetch novel config. Using default fee: 0.001 ETH`));
          }
        }

        const hash = await nominateCandidateTx(client, {
          novelId: BigInt(novelId),
          chapterId: BigInt(chapterId),
          value,
          roundManager: contracts.roundManager,
        });
        txHash(hash);
        await waitForTx(hash);
        success("Chapter nominated");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  vote
    .command("commit <novel-id> <candidate-id> [salt]")
    .description(
      "Commit a vote. If salt is omitted, a random 32-byte salt is generated, " +
        "saved locally as backup, and submitted to the backend for keeper-assisted reveal.",
    )
    .option("--value <eth>", "vote stake in ETH")
    .option("--no-keeper", "skip backend submission (you must reveal manually later)")
    .action(async (novelId, candidateId, saltArg, opts) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const voter = client.account!.address;

        // Auto-generate a fresh random salt when not provided.
        const saltBytes32: `0x${string}` = saltArg ? toBytes32Salt(saltArg) : generateSalt();
        const commitHash = computeCommitHash(BigInt(candidateId), saltBytes32);

        console.log(chalk.gray(`  Salt (bytes32): ${saltBytes32}`));
        console.log(chalk.gray(`  Commit hash:    ${commitHash}`));

        // Resolve current round (needed for backend submission and local backup)
        const novel = await apiGet<Record<string, unknown>>(`/api/novels/${novelId}`).catch(() => null);
        const currentRound = Number(novel?.current_round ?? 0);

        // Resolve voteStake from on-chain config (fallback to flag, fallback to default)
        let value: bigint;
        if (opts.value) {
          value = parseEther(opts.value);
        } else if (novel) {
          const config = novel.config as Record<string, string>;
          value = BigInt(config.voteStake ?? "0");
        } else {
          value = parseEther("0.005");
          console.log(chalk.yellow(`  Could not fetch novel config. Using default stake: 0.005 ETH`));
        }

        const hash = await commitVoteTx(client, {
          novelId: BigInt(novelId),
          commitHash,
          value,
          roundManager: contracts.roundManager,
        });
        txHash(hash);
        await waitForTx(hash);

        // Persist salt locally as the user's backup, regardless of keeper-assisted reveal.
        if (currentRound > 0) {
          saveVoteSalt({
            novelId: novelId.toString(),
            round: currentRound,
            candidateId: candidateId.toString(),
            salt: saltBytes32,
            voter,
          });
          console.log(chalk.gray(`  Salt saved to ${getStorePath()}`));
        }

        // Best-effort: submit plaintext vote to backend for keeper-assisted reveal.
        // The backend signs canonical message and we sign it with the wallet.
        if (opts.keeper !== false && currentRound > 0) {
          const ts = Math.floor(Date.now() / 1000);
          const message =
            `Submit vote on novel ${novelId} round ${currentRound} for candidate ${candidateId} at ${ts}`;
          const signature = await client.signMessage({ account: client.account!, message });

          const result = await apiPost("/api/votes/submit", {
            address: voter,
            novelId: Number(novelId),
            round: currentRound,
            candidateId: Number(candidateId),
            salt: saltBytes32,
            timestamp: ts,
            signature,
          });

          if (result.status === 201) {
            success("Vote committed. Keeper will auto-reveal during the reveal phase.");
          } else if (result.status === 503) {
            success("Vote committed (keeper-assisted reveal disabled on backend).");
            console.log(chalk.yellow("  You will need to reveal manually with: vote reveal <novel-id> <candidate-id> <salt>"));
          } else {
            success("Vote committed.");
            console.log(
              chalk.yellow(
                `  Backend rejected /api/votes/submit (status ${result.status}). You will need to reveal manually.`,
              ),
            );
          }
        } else {
          success("Vote committed. Remember to reveal during the reveal phase.");
        }
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  vote
    .command("reveal <novel-id> <candidate-id> [salt]")
    .description(
      "Reveal a previously committed vote. If salt is omitted, falls back to the local backup " +
        "saved by `vote commit`.",
    )
    .action(async (novelId, candidateId, saltArg) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const voter = client.account!.address;

        let saltBytes32: `0x${string}`;
        if (saltArg) {
          saltBytes32 = toBytes32Salt(saltArg);
        } else {
          // Fall back to local backup
          const novel = await apiGet<Record<string, unknown>>(`/api/novels/${novelId}`);
          const currentRound = Number(novel.current_round ?? 0);
          const stored = getVoteSalt(BigInt(novelId), currentRound, voter);
          if (!stored) {
            error(`No salt provided and no local backup found for round ${currentRound}.`);
            process.exit(1);
          }
          saltBytes32 = stored.salt;
          console.log(chalk.gray(`  Using salt from local backup (round ${currentRound})`));
        }

        const hash = await revealVoteTx(client, {
          novelId: BigInt(novelId),
          candidateId: BigInt(candidateId),
          salt: saltBytes32,
          roundManager: contracts.roundManager,
        });
        txHash(hash);
        await waitForTx(hash);
        success("Vote revealed");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  vote
    .command("settle <novel-id>")
    .description("Settle the current round (keeper action)")
    .action(async (novelId) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await settleRoundTx(client, BigInt(novelId), contracts.roundManager);
        txHash(hash);
        await waitForTx(hash);
        success("Round settled");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  vote
    .command("claim <novel-id> <round>")
    .description("Claim voting reward for a specific round")
    .action(async (novelId, round) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await claimVotingRewardTx(
          client,
          BigInt(novelId),
          parseInt(round),
          contracts.roundManager,
        );
        txHash(hash);
        await waitForTx(hash);
        success("Voting reward claimed");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  vote
    .command("candidates <novel-id>")
    .description("Show current round candidates")
    .action(async (novelId) => {
      try {
        // Get novel info to find current round
        const novel = await apiGet<Record<string, unknown>>(`/api/novels/${novelId}`);
        const currentRound = Number(novel.current_round);
        const phase = Number(novel.round_phase);

        header(`Voting — Novel #${novelId}`);
        kv("Current Round", currentRound);
        kv("Phase", roundPhaseName(phase));

        if (currentRound === 0) {
          console.log(chalk.yellow("\n  No voting round has started yet.\n"));
          return;
        }

        // Get round data from API
        const roundData = await apiGet<{ votes: Record<string, unknown>[] }>(
          `/api/novels/${novelId}/rounds/${currentRound}`,
        );

        // Get world lines
        const wlData = await apiGet<{ worldlines: Record<string, unknown>[] }>(
          `/api/novels/${novelId}/worldlines`,
        );

        if (wlData.worldlines.length > 0) {
          console.log(chalk.bold("\n  World Lines:"));
          for (const wl of wlData.worldlines) {
            console.log(`    Chapter #${wl.id} (depth=${wl.depth}) by ${String(wl.author ?? "").slice(0, 10)}...`);
          }
        }

        if (roundData.votes.length > 0) {
          console.log(chalk.bold("\n  Votes:"));
          table(
            roundData.votes.map((v) => ({
              Voter: String(v.voter ?? "").slice(0, 12) + "...",
              Revealed: v.revealed ? "Yes" : "No",
              Candidate: v.revealed ? v.candidate_id : "-",
              Claimed: v.claimed ? "Yes" : "No",
            })),
          );
        }
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}

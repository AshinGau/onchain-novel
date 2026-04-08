import { Command } from "commander";
import { parseEther } from "viem";
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
} from "onchain-novel-shared";
import { getWalletClient, getContracts } from "../utils/client.js";
import { apiGet } from "../utils/api.js";
import { header, kv, success, error, txHash, table, roundPhaseName } from "../utils/format.js";
import chalk from "chalk";

export function registerVoteCommands(program: Command): void {
  const vote = program.command("vote").description("Voting commands");

  vote
    .command("start <novel-id>")
    .description("Start a new voting round (keeper action)")
    .action(async (novelId) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await startRoundTx(client, BigInt(novelId), contracts.novelCore);
        txHash(hash);
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
        const hash = await closeNominationTx(client, BigInt(novelId), contracts.novelCore);
        txHash(hash);
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
        const hash = await closeCommitTx(client, BigInt(novelId), contracts.novelCore);
        txHash(hash);
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
          novelCore: contracts.novelCore,
        });
        txHash(hash);
        success("Chapter nominated");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  vote
    .command("commit <novel-id> <candidate-id> <salt>")
    .description("Commit a vote (commit-reveal scheme)")
    .option("--value <eth>", "vote stake in ETH")
    .action(async (novelId, candidateId, salt, opts) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();

        const saltBytes32 = toBytes32Salt(salt);
        const commitHash = computeCommitHash(BigInt(candidateId), saltBytes32);

        console.log(chalk.gray(`  Salt (bytes32): ${saltBytes32}`));
        console.log(chalk.gray(`  Commit hash: ${commitHash}`));

        let value: bigint;
        if (opts.value) {
          value = parseEther(opts.value);
        } else {
          try {
            const novel = await apiGet<Record<string, unknown>>(`/api/novels/${novelId}`);
            const config = novel.config as Record<string, string>;
            value = BigInt(config.voteStake ?? "0");
          } catch {
            value = parseEther("0.001");
            console.log(chalk.yellow(`  Could not fetch novel config. Using default stake: 0.001 ETH`));
          }
        }

        const hash = await commitVoteTx(client, {
          novelId: BigInt(novelId),
          commitHash,
          value,
          novelCore: contracts.novelCore,
        });
        txHash(hash);
        success("Vote committed. Remember your salt to reveal later!");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  vote
    .command("reveal <novel-id> <candidate-id> <salt>")
    .description("Reveal a previously committed vote")
    .action(async (novelId, candidateId, salt) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const saltBytes32 = toBytes32Salt(salt);

        const hash = await revealVoteTx(client, {
          novelId: BigInt(novelId),
          candidateId: BigInt(candidateId),
          salt: saltBytes32,
          novelCore: contracts.novelCore,
        });
        txHash(hash);
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
        const hash = await settleRoundTx(client, BigInt(novelId), contracts.novelCore);
        txHash(hash);
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
          contracts.novelCore,
        );
        txHash(hash);
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

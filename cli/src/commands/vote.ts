import { randomBytes } from "node:crypto";
import chalk from "chalk";
import { Command } from "commander";
import { parseEther, toHex } from "viem";

import {
  buildPathToAnchor,
  claimVotingReward as claimVotingRewardTx,
  closeCommit as closeCommitTx,
  closeNomination as closeNominationTx,
  commitVote as commitVoteTx,
  computeCommitHash,
  nominateCandidate as nominateCandidateTx,
  revealVote as revealVoteTx,
  settleRound as settleRoundTx,
  startRound as startRoundTx,
  toBytes32Salt,
} from "../shared/index.js";
import { privateKeyToAccount } from "viem/accounts";

import { apiGet, apiPost, fetchNovelConfig } from "../utils/api.js";
import { getContracts, getPublicClient, getWalletClient, waitForTx } from "../utils/client.js";
import { getPrivateKey } from "../utils/config.js";
import { error, eth, header, kv, roundPhaseName, success, table, txHash } from "../utils/format.js";
import { getStorePath, getVoteSalt, listVoteSalts, saveVoteSalt } from "../utils/vote-store.js";

function parseIdList(raw: string): bigint[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => BigInt(s));
}

/** Generate a fresh 32-byte random salt as 0x-prefixed hex */
function generateSalt(): `0x${string}` {
  return toHex(randomBytes(32));
}

export function registerVoteCommands(program: Command): void {
  const vote = program.command("vote").description("Voting commands");

  vote
    .command("start <novel-id> <leaves>")
    .description(
      "Start a new voting round (keeper / owner only). " +
        "<leaves> is a comma-separated list of leaf chapter IDs (one per current world line, " +
        "deepest leaf preferred). Each must be a true tree leaf (no children).",
    )
    .action(async (novelId, leavesArg) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await startRoundTx(client, {
          novelId: BigInt(novelId),
          leaves: parseIdList(leavesArg),
          roundManager: contracts.roundManager,
        });
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
    .description(
      "Nominate a chapter as candidate. By default the path proof (chapter → current " +
        "worldLineAncestor) is auto-computed so the nominator is reward-eligible. " +
        "Pass --forfeit to nominate an arbitrary chapter with no reward eligibility (empty path).",
    )
    .option("--value <eth>", "nomination fee in ETH")
    .option("--forfeit", "nominate without reward eligibility (skip path proof)")
    .action(async (novelId, chapterId, opts) => {
      try {
        const client = getWalletClient();
        const pub = getPublicClient();
        const contracts = getContracts();

        let value: bigint;
        if (opts.value) {
          value = parseEther(opts.value);
        } else {
          const { config } = await fetchNovelConfig(novelId);
          value = BigInt(config.nominationFee ?? "0");
        }

        let path: bigint[] = [];
        if (!opts.forfeit) {
          // Build path proof: nominated chapter → current worldLineAncestor
          const ancestors = (await pub.readContract({
            address: contracts.novelCore,
            abi: (await import("../shared/abi.js")).novelCoreAbi,
            functionName: "getWorldLineAncestors",
            args: [BigInt(novelId)],
          })) as readonly bigint[];
          const proof = await buildPathToAnchor(
            pub,
            contracts.novelCore,
            BigInt(novelId),
            BigInt(chapterId),
            ancestors,
          );
          if (!proof || proof.length < 2) {
            error(
              `Chapter #${chapterId} is not a strict descendant of any current worldLineAncestor of novel #${novelId}. ` +
                `Pass --forfeit to nominate anyway (no reward eligibility).`,
            );
            return process.exit(1);
          }
          path = proof;
        }

        const hash = await nominateCandidateTx(client, {
          novelId: BigInt(novelId),
          chapterId: BigInt(chapterId),
          path,
          value,
          roundManager: contracts.roundManager,
        });
        txHash(hash);
        await waitForTx(hash);
        success(opts.forfeit ? "Chapter nominated (forfeit mode)" : "Chapter nominated");
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
        const commitHash = computeCommitHash(voter, BigInt(candidateId), saltBytes32);

        console.log(chalk.gray(`  Salt (bytes32): ${saltBytes32}`));
        console.log(chalk.gray(`  Commit hash:    ${commitHash}`));

        // Resolve current round + voteStake from backend. Fail-fast if unreachable:
        // committing with a wrong stake wastes gas and loses the reveal window.
        const { novel, config } = await fetchNovelConfig(novelId);
        const currentRound = Number(novel.current_round ?? 0);
        const value = opts.value ? parseEther(opts.value) : BigInt(config.voteStake ?? "0");

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
          const message = `Submit vote on novel ${novelId} round ${currentRound} for candidate ${candidateId} at ${ts}`;
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
            console.log(
              chalk.yellow(
                "  You will need to reveal manually with: vote reveal <novel-id> <candidate-id> <salt>",
              ),
            );
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
        "saved by `vote commit`. Anyone can call revealVote on behalf of a voter — only the " +
        "matching voter address whose commit hash equals keccak(voter, c, s) will succeed.",
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
          voter,
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
    .description(
      "Settle the current round (keeper / owner, or anyone after the timeout). " +
        "Winner reward-author derivation happens fully on-chain via NovelCore.collectPathAuthors.",
    )
    .action(async (novelId) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await settleRoundTx(client, {
          novelId: BigInt(novelId),
          roundManager: contracts.roundManager,
        });
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
            console.log(
              `    Chapter #${wl.id} (depth=${wl.depth}) by ${String(wl.author ?? "").slice(0, 10)}...`,
            );
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

  vote
    .command("discover")
    .description(
      "List active novels with a round in progress — the starting point for an agent looking " +
        "for voting opportunities. Shows phase, deadline, and whether you already voted.",
    )
    .option("--phase <phase>", "filter by phase: nominating|committing|revealing|all", "all")
    .option("--limit <n>", "max novels to scan", "100")
    .action(async (opts) => {
      try {
        const wantPhase = String(opts.phase).toLowerCase();
        const phaseMap: Record<string, number> = {
          nominating: 1,
          committing: 2,
          revealing: 3,
        };
        const phaseFilter = wantPhase === "all" ? null : phaseMap[wantPhase];
        if (wantPhase !== "all" && phaseFilter === undefined) {
          error(`Invalid --phase. Use one of: nominating, committing, revealing, all`);
          process.exit(1);
        }

        const limit = Math.min(parseInt(String(opts.limit)) || 100, 100);
        const data = await apiGet<{ novels: Record<string, unknown>[] }>(
          `/api/novels?filter=active&limit=${limit}&sort=active`,
        );

        const now = Math.floor(Date.now() / 1000);
        const pk = getPrivateKey();
        const myAddr = pk ? privateKeyToAccount(pk).address.toLowerCase() : null;

        const rows: Record<string, unknown>[] = [];
        for (const n of data.novels) {
          const phase = Number(n.round_phase);
          if (phase === 0) continue; // Idle — nothing to do for a voter
          if (phaseFilter !== null && phase !== phaseFilter) continue;

          const cfg = (n.config as Record<string, string>) ?? {};
          const phaseStart = Number(n.phase_start_time ?? 0);
          const durKey =
            phase === 1 ? "nominateDuration" : phase === 2 ? "commitDuration" : "revealDuration";
          const duration = Number(cfg[durKey] ?? 0);
          const deadline = phaseStart + duration;
          const remaining = deadline - now;

          let already = "-";
          let voterCount = 0;
          if (phase >= 2) {
            try {
              const round = Number(n.current_round);
              if (round > 0) {
                const rd = await apiGet<{ votes: Record<string, unknown>[] }>(
                  `/api/novels/${n.id}/rounds/${round}`,
                );
                voterCount = rd.votes.length;
                if (myAddr) {
                  const mine = rd.votes.find(
                    (v) => String(v.voter ?? "").toLowerCase() === myAddr,
                  );
                  already = mine ? (mine.revealed ? "revealed" : "committed") : "no";
                }
              }
            } catch {
              // best effort
            }
          }

          rows.push({
            Novel: `#${n.id}`,
            Title: String(n.title ?? "").slice(0, 28),
            Round: n.current_round,
            Phase: roundPhaseName(phase),
            Deadline:
              remaining > 0
                ? `${Math.floor(remaining / 3600)}h${Math.floor((remaining % 3600) / 60)}m`
                : chalk.red("expired"),
            Pool: eth(BigInt(String(n.pool_balance ?? "0"))),
            Voters: voterCount,
            VoteStake: cfg.voteStake ? eth(cfg.voteStake) : "-",
            Voted: already,
          });
        }

        header("Voting Opportunities");
        if (rows.length === 0) {
          console.log(chalk.gray("  No novels currently in a voting phase.\n"));
          return;
        }
        table(rows);
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  vote
    .command("status <novel-id>")
    .description(
      "Show your voting status for a novel: current phase, deadline, locally-stored salts, " +
        "and on-chain reveal status. Use this to avoid missing the reveal window.",
    )
    .action(async (novelId) => {
      try {
        const novel = await apiGet<Record<string, unknown>>(`/api/novels/${novelId}`);
        const round = Number(novel.current_round ?? 0);
        const phase = Number(novel.round_phase ?? 0);
        const cfg = (novel.config as Record<string, string>) ?? {};
        const phaseStart = Number(novel.phase_start_time ?? 0);
        const now = Math.floor(Date.now() / 1000);

        header(`Vote Status — Novel #${novelId}`);
        kv("Round", round);
        kv("Phase", roundPhaseName(phase));

        if (phase !== 0) {
          const durKey =
            phase === 1 ? "nominateDuration" : phase === 2 ? "commitDuration" : "revealDuration";
          const duration = Number(cfg[durKey] ?? 0);
          const deadline = phaseStart + duration;
          const remaining = deadline - now;
          kv(
            "Deadline",
            remaining > 0
              ? `in ${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m`
              : chalk.red("expired"),
          );
        }

        const pk = getPrivateKey();
        if (!pk) {
          console.log(chalk.gray("\n  (PRIVATE_KEY not set — skipping per-voter details)\n"));
          return;
        }
        const voter = privateKeyToAccount(pk).address;
        kv("Voter", voter);

        // On-chain votes for this round
        if (round > 0) {
          try {
            const rd = await apiGet<{ votes: Record<string, unknown>[] }>(
              `/api/novels/${novelId}/rounds/${round}`,
            );
            const mine = rd.votes.filter(
              (v) => String(v.voter ?? "").toLowerCase() === voter.toLowerCase(),
            );
            if (mine.length > 0) {
              console.log(chalk.bold("\n  On-chain votes this round:"));
              table(
                mine.map((v) => ({
                  Committed: v.commit_hash ? "yes" : "no",
                  Revealed: v.revealed ? "yes" : "no",
                  Candidate: v.revealed ? v.candidate_id : "-",
                  Claimed: v.claimed ? "yes" : "no",
                })),
              );
            }
          } catch {
            // best effort
          }
        }

        // Local salt backups (all rounds)
        const salts = listVoteSalts(BigInt(novelId), voter);
        if (salts.length > 0) {
          console.log(chalk.bold("\n  Local salt backups:"));
          table(
            salts.slice(0, 10).map((s) => ({
              Round: s.round,
              Candidate: s.candidateId,
              SavedAt: new Date(s.createdAt * 1000).toISOString().slice(0, 19).replace("T", " "),
            })),
          );
          kv("Store", getStorePath());
        } else {
          console.log(chalk.gray("\n  No local salt backups for this novel."));
        }
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}

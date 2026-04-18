import type pg from "pg";
import { decodeFunctionData, type Log, type PublicClient } from "viem";

import { signalKeeper, type KeeperSignalBuffer } from "../keeper/index.js";
import {
  bountyBoardAbi,
  novelCoreAbi,
  prizePoolAbi,
  roundManagerAbi,
  rulesEngineAbi,
  userRegistryAbi,
  votingEngineAbi,
} from "@onchain-novel/shared/chain";
import { env } from "../utils/env.js";
import { addrLc, eventMeta, safeDecode } from "../utils/event-meta.js";
import { createLogger } from "../utils/logger.js";
import { ContentLocation } from "../utils/validate.js";
import { fetchChapterContent } from "./content-fetcher.js";

const hlog = createLogger("indexer:handlers");

type Client = pg.PoolClient;

// ============================================================
// NovelCore Event Handler — novels, chapters, metadata, claims
// ============================================================

export async function handleNovelCoreEvent(
  log: Log,
  db: Client,
  rpc: PublicClient,
  keeperBuf: KeeperSignalBuffer | null = null,
) {
  const decoded = safeDecode(novelCoreAbi, log);
  if (!decoded) return;
  const { blockNumber } = eventMeta(log);
  const handlerStart = Date.now();

  switch (decoded.eventName) {
    case "NovelCreated":
    case "NovelForked": {
      const { novelId } = decoded.args as { novelId: bigint };
      hlog.info({ event: decoded.eventName, novelId, block: blockNumber }, "event received");
      await insertNovelFromChain(db, rpc, novelId, blockNumber);
      hlog.debug(
        { event: decoded.eventName, novelId, ms: Date.now() - handlerStart },
        "event done",
      );
      break;
    }

    case "ChapterSubmitted": {
      const { novelId, chapterId, author, parentId, depth } = decoded.args as {
        novelId: bigint;
        chapterId: bigint;
        author: string;
        parentId: bigint;
        depth: number;
      };
      hlog.info(
        { event: "ChapterSubmitted", chapterId, novelId, author, block: blockNumber },
        "event received",
      );

      const chapter = (await rpc.readContract({
        address: env.NOVEL_CORE_ADDRESS,
        abi: novelCoreAbi,
        functionName: "getChapter",
        args: [chapterId],
      })) as any;

      await db.query(
        `INSERT INTO chapters (id, novel_id, parent_id, author, content_hash, declared_length,
                depth, "timestamp", is_world_line, block_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          chapterId.toString(),
          novelId.toString(),
          parentId.toString(),
          addrLc(author),
          chapter.contentHash,
          chapter.declaredLength.toString(),
          depth,
          chapter.timestamp.toString(),
          depth === 1,
          blockNumber,
        ],
      );

      await db.query("UPDATE novels SET last_chapter_at = NOW() WHERE id = $1", [
        novelId.toString(),
      ]);

      // Content decoding
      const novelRes = await db.query("SELECT content_location FROM novels WHERE id = $1", [
        novelId.toString(),
      ]);
      if (
        novelRes.rows.length > 0 &&
        novelRes.rows[0].content_location === ContentLocation.Onchain
      ) {
        try {
          const tx = await rpc.getTransaction({ hash: log.transactionHash! });
          const { args: txArgs, functionName: txFnName } = decodeFunctionData({
            abi: novelCoreAbi,
            data: tx.input,
          });

          // submitChapter(novelId, parentId, submission) -> args[2]
          // createNovel(config, metadata, rootChapter) -> args[2]
          // forkNovel(sourceChapterId, config, metadata, rootChapter) -> args[3]
          let submissionArgIndex = 2;
          if (txFnName === "forkNovel") submissionArgIndex = 3;

          const submission = (txArgs as any)[submissionArgIndex];
          if (submission && submission.content) {
            const contentBytes = submission.content as `0x${string}`;
            if (contentBytes.length > 2) {
              const textContent = Buffer.from(contentBytes.slice(2), "hex").toString("utf-8");
              await db.query(
                "UPDATE chapters SET content_text = $1, content_fetched = TRUE WHERE id = $2",
                [textContent, chapterId.toString()],
              );
            }
          }
        } catch (err) {
          hlog.error({ err, chapterId }, "Failed to decode calldata");
        }
      } else {
        fetchChapterContent(chapterId, novelId).catch((err) =>
          hlog.error({ err, chapterId }, "Content fetch failed"),
        );
      }
      hlog.debug(
        { event: "ChapterSubmitted", chapterId, ms: Date.now() - handlerStart },
        "event done",
      );
      signalKeeper(novelId, keeperBuf);
      break;
    }

    case "NovelMetadataUpdated": {
      const { novelId, title, description, coverUri } = decoded.args as {
        novelId: bigint;
        title: string;
        description: string;
        coverUri: string;
      };
      await db.query(
        "UPDATE novels SET title = $1, description = $2, cover_uri = $3 WHERE id = $4",
        [title, description, coverUri, novelId.toString()],
      );
      break;
    }

    case "RewardClaimed": {
      // PrizePool-side claim; PrizePool.RewardClaimed handler inserts into reward_claims.
      break;
    }
  }
}

// ============================================================
// RoundManager Event Handler — round lifecycle, completion
// ============================================================

export async function handleRoundManagerEvent(
  log: Log,
  db: Client,
  rpc: PublicClient,
  keeperBuf: KeeperSignalBuffer | null = null,
) {
  const decoded = safeDecode(roundManagerAbi, log);
  if (!decoded) return;
  const { blockNumber } = eventMeta(log);

  switch (decoded.eventName) {
    case "RoundStarted": {
      const { novelId, round, candidates } = decoded.args as {
        novelId: bigint;
        round: number;
        candidates: readonly bigint[];
      };
      hlog.info(
        {
          event: "RoundStarted",
          novelId,
          round,
          candidates: candidates.length,
          block: blockNumber,
        },
        "event received",
      );

      await db.query(
        "UPDATE novels SET current_round = $1, round_phase = 1, phase_start_time = $2 WHERE id = $3",
        [round, await getBlockTimestamp(rpc, log.blockNumber ?? null), novelId.toString()],
      );

      for (let i = 0; i < candidates.length; i++) {
        await db.query(
          `INSERT INTO round_candidates (novel_id, round, chapter_id, position, nominator, block_number)
           VALUES ($1, $2, $3, $4, NULL, $5) ON CONFLICT DO NOTHING`,
          [novelId.toString(), round, candidates[i].toString(), i, blockNumber],
        );
      }

      signalKeeper(novelId, keeperBuf);
      break;
    }

    case "NominationClosed": {
      const { novelId, round } = decoded.args as { novelId: bigint; round: number };
      hlog.info(
        { event: "NominationClosed", novelId, round, block: blockNumber },
        "event received",
      );
      await db.query("UPDATE novels SET round_phase = 2, phase_start_time = $1 WHERE id = $2", [
        await getBlockTimestamp(rpc, log.blockNumber ?? null),
        novelId.toString(),
      ]);
      signalKeeper(novelId, keeperBuf);
      break;
    }

    case "CommitClosed": {
      const { novelId, round } = decoded.args as { novelId: bigint; round: number };
      hlog.info({ event: "CommitClosed", novelId, round, block: blockNumber }, "event received");
      await db.query("UPDATE novels SET round_phase = 3, phase_start_time = $1 WHERE id = $2", [
        await getBlockTimestamp(rpc, log.blockNumber ?? null),
        novelId.toString(),
      ]);
      signalKeeper(novelId, keeperBuf);
      break;
    }

    case "RoundSettled": {
      const { novelId, round, worldLines } = decoded.args as {
        novelId: bigint;
        round: number;
        worldLines: readonly bigint[];
      };
      hlog.info(
        {
          event: "RoundSettled",
          novelId,
          round,
          worldLines: worldLines.map((w: bigint) => w.toString()),
          block: blockNumber,
        },
        "event received",
      );
      const timestamp = await getBlockTimestamp(rpc, log.blockNumber ?? null);
      await db.query(
        "UPDATE novels SET round_phase = 0, phase_start_time = $1, last_settle_time = $1 WHERE id = $2",
        [timestamp, novelId.toString()],
      );

      await db.query(
        "UPDATE chapters SET is_world_line = FALSE WHERE novel_id = $1 AND is_world_line = TRUE",
        [novelId.toString()],
      );
      for (const id of worldLines) {
        await db.query("UPDATE chapters SET is_world_line = TRUE WHERE id = $1", [id.toString()]);
      }

      // Round is finalized; any leftover pending_votes (revealed / failed / never seen)
      // have served their purpose. Drop them to keep the table bounded and to avoid
      // retaining encrypted salts past their useful life.
      await db.query("DELETE FROM pending_votes WHERE novel_id = $1 AND round = $2", [
        novelId.toString(),
        round,
      ]);

      signalKeeper(novelId, keeperBuf);
      break;
    }

    case "CandidateNominated": {
      const { novelId, round, chapterId, nominator } = decoded.args as {
        novelId: bigint;
        round: number;
        chapterId: bigint;
        nominator: string;
      };
      hlog.info(
        { event: "CandidateNominated", novelId, round, chapterId, block: blockNumber },
        "event received",
      );
      // Append after the existing keeper leaves. Max 64 per round (MAX_CANDIDATES_PER_ROUND).
      await db.query(
        `INSERT INTO round_candidates (novel_id, round, chapter_id, position, nominator, block_number)
         VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), -1) + 1 FROM round_candidates WHERE novel_id = $1 AND round = $2), $4, $5)
         ON CONFLICT DO NOTHING`,
        [novelId.toString(), round, chapterId.toString(), addrLc(nominator), blockNumber],
      );
      break;
    }

    case "VoteCommitted":
    case "VoteRevealed": {
      // VotingEngine is the sole authoritative source for vote events; both events are
      // intentionally dropped here. The duplicate emit from RoundManager.sol is kept for
      // on-chain auditability, but the indexer never writes from it.
      break;
    }

    case "NovelCompleted": {
      const { novelId } = decoded.args as { novelId: bigint };
      await db.query("UPDATE novels SET active = FALSE WHERE id = $1", [novelId.toString()]);
      break;
    }

    case "KeeperRewarded": {
      // PrizePool.KeeperRewardPaid is the authoritative source with the actual amount;
      // RoundManager re-emits for event parity. No-op here.
      break;
    }

    case "RewardClaimed": {
      // VotingEngine.VotingRewardClaimed is the authoritative source for voter claims.
      break;
    }
  }
}

// ============================================================
// VotingEngine Event Handler
// ============================================================

export async function handleVotingEvent(log: Log, db: Client) {
  const decoded = safeDecode(votingEngineAbi, log);
  if (!decoded) return;
  const { blockNumber } = eventMeta(log);

  switch (decoded.eventName) {
    case "VoteCommitted": {
      const { novelId, round, voter } = decoded.args as {
        novelId: bigint;
        round: number;
        voter: string;
      };
      await db.query(
        `INSERT INTO votes (novel_id, round, voter, commit_block)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [novelId.toString(), round, addrLc(voter), blockNumber],
      );
      break;
    }

    case "VoteRevealed": {
      const { novelId, round, voter, candidateId } = decoded.args as {
        novelId: bigint;
        round: number;
        voter: string;
        candidateId: bigint;
      };
      await db.query(
        `UPDATE votes SET revealed = TRUE, candidate_id = $1, reveal_block = $2
         WHERE novel_id = $3 AND round = $4 AND voter = $5`,
        [candidateId.toString(), blockNumber, novelId.toString(), round, addrLc(voter)],
      );
      break;
    }

    case "VotesTallied": {
      const { novelId, round, rankedCandidateIds } = decoded.args as {
        novelId: bigint;
        round: number;
        rankedCandidateIds: readonly bigint[];
      };
      await db.query(
        `INSERT INTO round_rewards (novel_id, round, ranked_candidates, block_number)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (novel_id, round)
         DO UPDATE SET ranked_candidates = EXCLUDED.ranked_candidates,
                       block_number = GREATEST(round_rewards.block_number, EXCLUDED.block_number)`,
        [novelId.toString(), round, rankedCandidateIds.map((id) => id.toString()), blockNumber],
      );
      break;
    }

    case "VoterRewardsSettled": {
      const { novelId, round, totalRewardPool } = decoded.args as {
        novelId: bigint;
        round: number;
        totalRewardPool: bigint;
      };
      await db.query(
        `INSERT INTO round_rewards (novel_id, round, total_voter_pool, block_number)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (novel_id, round)
         DO UPDATE SET total_voter_pool = EXCLUDED.total_voter_pool,
                       block_number = GREATEST(round_rewards.block_number, EXCLUDED.block_number)`,
        [novelId.toString(), round, totalRewardPool.toString(), blockNumber],
      );
      break;
    }

    case "VotingRewardClaimed": {
      const { novelId, round, voter, amount } = decoded.args as {
        novelId: bigint;
        round: number;
        voter: string;
        amount: bigint;
      };
      const voterLc = addrLc(voter);
      await db.query(
        "UPDATE votes SET claimed = TRUE WHERE novel_id = $1 AND round = $2 AND voter = $3",
        [novelId.toString(), round, voterLc],
      );
      await db.query(
        "INSERT INTO reward_claims (novel_id, claimant, amount, source, round, block_number) VALUES ($1, $2, $3, 'voting', $4, $5)",
        [novelId.toString(), voterLc, amount.toString(), round, blockNumber],
      );
      break;
    }

    default:
      break;
  }
}

// ============================================================
// PrizePool Event Handler
// ============================================================

export async function handlePrizePoolEvent(log: Log, db: Client) {
  const decoded = safeDecode(prizePoolAbi, log);
  if (!decoded) return;
  const { blockNumber } = eventMeta(log);

  switch (decoded.eventName) {
    case "PoolDeposited": {
      const { novelId, amount } = decoded.args as { novelId: bigint; amount: bigint };
      await db.query("UPDATE novels SET total_funded = total_funded + $1 WHERE id = $2", [
        amount.toString(),
        novelId.toString(),
      ]);
      break;
    }

    case "TipReceived": {
      const { novelId, tipper, amount } = decoded.args as {
        novelId: bigint;
        tipper: string;
        amount: bigint;
      };
      await db.query(
        "INSERT INTO tips (novel_id, tipper, amount, block_number) VALUES ($1, $2, $3, $4)",
        [novelId.toString(), addrLc(tipper), amount.toString(), blockNumber],
      );
      await db.query(
        "UPDATE novels SET total_tipped = total_tipped + $1, total_funded = total_funded + $1 WHERE id = $2",
        [amount.toString(), novelId.toString()],
      );
      break;
    }

    case "ChapterTipped": {
      const { novelId, chapterId, tipper, amount } = decoded.args as {
        novelId: bigint;
        chapterId: bigint;
        tipper: string;
        amount: bigint;
      };
      const chapterRes = await db.query("SELECT author FROM chapters WHERE id = $1", [
        chapterId.toString(),
      ]);
      const author = chapterRes.rows[0]?.author ?? "";
      await db.query(
        "INSERT INTO chapter_tips (chapter_id, novel_id, tipper, author, amount, block_number) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          chapterId.toString(),
          novelId.toString(),
          addrLc(tipper),
          author,
          amount.toString(),
          blockNumber,
        ],
      );
      break;
    }

    case "RewardClaimed": {
      const { novelId, recipient, amount } = decoded.args as {
        novelId: bigint;
        recipient: string;
        amount: bigint;
      };
      await db.query(
        "INSERT INTO reward_claims (novel_id, claimant, amount, source, block_number) VALUES ($1, $2, $3, 'prize_pool', $4)",
        [novelId.toString(), addrLc(recipient), amount.toString(), blockNumber],
      );
      break;
    }

    case "RoundRewardsDistributed": {
      const { novelId, round, creatorRoyalty, authorRewards, voterRewards } = decoded.args as {
        novelId: bigint;
        round: number;
        creatorRoyalty: bigint;
        authorRewards: bigint;
        voterRewards: bigint;
      };
      await db.query(
        `INSERT INTO round_rewards (novel_id, round, creator_royalty, author_rewards, voter_rewards, block_number)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (novel_id, round)
         DO UPDATE SET creator_royalty = EXCLUDED.creator_royalty,
                       author_rewards  = EXCLUDED.author_rewards,
                       voter_rewards   = EXCLUDED.voter_rewards,
                       block_number    = GREATEST(round_rewards.block_number, EXCLUDED.block_number)`,
        [
          novelId.toString(),
          round,
          creatorRoyalty.toString(),
          authorRewards.toString(),
          voterRewards.toString(),
          blockNumber,
        ],
      );
      break;
    }

    case "KeeperRewardPaid": {
      const { novelId, keeper, amount } = decoded.args as {
        novelId: bigint;
        keeper: string;
        amount: bigint;
      };
      await db.query(
        "INSERT INTO keeper_rewards (novel_id, keeper, amount, block_number) VALUES ($1, $2, $3, $4)",
        [novelId.toString(), addrLc(keeper), amount.toString(), blockNumber],
      );
      break;
    }

    default:
      break;
  }
}

// ============================================================
// BountyBoard Event Handler
// ============================================================

export async function handleBountyBoardEvent(log: Log, db: Client) {
  const decoded = safeDecode(bountyBoardAbi, log);
  if (!decoded) return;
  const { blockNumber } = eventMeta(log);

  switch (decoded.eventName) {
    case "BountyCreated": {
      const { bountyId, chapterId, tipper, lockedAmount, createTime, deadline } = decoded.args as {
        bountyId: bigint;
        chapterId: bigint;
        tipper: string;
        lockedAmount: bigint;
        createTime: bigint;
        deadline: bigint;
      };
      const chapterRes = await db.query("SELECT novel_id FROM chapters WHERE id = $1", [
        chapterId.toString(),
      ]);
      const novelId = chapterRes.rows[0]?.novel_id ?? "0";
      await db.query(
        `INSERT INTO bounties (id, chapter_id, novel_id, tipper, locked_amount, create_time, deadline, block_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          bountyId.toString(),
          chapterId.toString(),
          novelId,
          addrLc(tipper),
          lockedAmount.toString(),
          createTime.toString(),
          deadline.toString(),
          blockNumber,
        ],
      );
      break;
    }

    case "BountyDesignated": {
      const { bountyId, chapterId } = decoded.args as { bountyId: bigint; chapterId: bigint };
      hlog.info({ event: "BountyDesignated", bountyId, chapterId }, "event received");
      await db.query("UPDATE bounties SET designated_chapter_id = $1 WHERE id = $2", [
        chapterId.toString(),
        bountyId.toString(),
      ]);
      break;
    }

    case "BountyClaimed": {
      const { bountyId, author, amount } = decoded.args as {
        bountyId: bigint;
        author: string;
        amount: bigint;
      };
      hlog.info(
        { event: "BountyClaimed", bountyId, author, amount, block: blockNumber },
        "event received",
      );
      // Append individual claim row; BountyBoard emits one per claimant (or one total for designated/single).
      await db.query(
        `INSERT INTO bounty_claims (bounty_id, author, amount, block_number)
         VALUES ($1, $2, $3, $4)`,
        [bountyId.toString(), addrLc(author), amount.toString(), blockNumber],
      );
      // Update aggregate on the parent bounty row; mark `claimed=TRUE` once any claim arrives.
      // Further claims from co-authors just accumulate into `claimed_amount`.
      await db.query(
        `UPDATE bounties
           SET claimed = TRUE,
               claimed_amount = claimed_amount + $1
         WHERE id = $2`,
        [amount.toString(), bountyId.toString()],
      );
      break;
    }

    case "BountyRefunded": {
      const { bountyId, amount } = decoded.args as {
        bountyId: bigint;
        tipper: string;
        amount: bigint;
      };
      await db.query(
        `UPDATE bounties
           SET claimed = TRUE,
               refunded_amount = refunded_amount + $1
         WHERE id = $2`,
        [amount.toString(), bountyId.toString()],
      );
      break;
    }
  }
}

// ============================================================
// RulesEngine Event Handler
// ============================================================

export async function handleRulesEvent(log: Log, db: Client, rpc: PublicClient) {
  const decoded = safeDecode(rulesEngineAbi, log);
  if (!decoded) return;
  const { blockNumber } = eventMeta(log);

  switch (decoded.eventName) {
    case "RuleSet": {
      const { novelId, name } = decoded.args as { novelId: bigint; name: string };
      const ruleContent = (await rpc.readContract({
        address: env.RULES_ENGINE_ADDRESS,
        abi: rulesEngineAbi,
        functionName: "getRule",
        args: [novelId, name],
      })) as string;
      await db.query(
        `INSERT INTO rules (novel_id, name, content, block_number)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (novel_id, name) DO UPDATE SET content = $3, block_number = $4`,
        [novelId.toString(), name, ruleContent, blockNumber],
      );
      break;
    }

    case "RuleDeleted": {
      const { novelId, name } = decoded.args as { novelId: bigint; name: string };
      await db.query("DELETE FROM rules WHERE novel_id = $1 AND name = $2", [
        novelId.toString(),
        name,
      ]);
      break;
    }

    case "RuleProposed": {
      const { proposalId, novelId, proposer, proposalType, ruleName } = decoded.args as {
        proposalId: bigint;
        novelId: bigint;
        proposer: string;
        proposalType: number;
        ruleName: string;
      };
      const proposal = (await rpc.readContract({
        address: env.RULES_ENGINE_ADDRESS,
        abi: rulesEngineAbi,
        functionName: "getRuleProposal",
        args: [proposalId],
      })) as any;
      await db.query(
        `INSERT INTO rule_proposals (id, novel_id, proposer, proposal_type, rule_name, rule_content, created_at, vote_count, executed, block_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          proposalId.toString(),
          novelId.toString(),
          addrLc(proposer),
          proposalType,
          ruleName,
          proposal.ruleContent,
          proposal.createdAt.toString(),
          0,
          false,
          blockNumber,
        ],
      );
      break;
    }

    case "RuleProposalVoted": {
      const { proposalId, voter, newVoteCount } = decoded.args as {
        proposalId: bigint;
        voter: string;
        newVoteCount: number;
      };
      await db.query(
        `INSERT INTO rule_proposal_votes (proposal_id, voter, block_number)
         VALUES ($1, $2, $3)
         ON CONFLICT (proposal_id, voter) DO NOTHING`,
        [proposalId.toString(), addrLc(voter), blockNumber],
      );
      await db.query("UPDATE rule_proposals SET vote_count = $1 WHERE id = $2", [
        newVoteCount,
        proposalId.toString(),
      ]);
      break;
    }

    case "RuleProposalExecuted": {
      const { proposalId } = decoded.args as { proposalId: bigint };
      await db.query("UPDATE rule_proposals SET executed = TRUE WHERE id = $1", [
        proposalId.toString(),
      ]);
      break;
    }
  }
}

// ============================================================
// UserRegistry Event Handler — nicknames
// ============================================================

export async function handleUserRegistryEvent(log: Log, db: Client) {
  const decoded = safeDecode(userRegistryAbi, log);
  if (!decoded) return;
  const { blockNumber } = eventMeta(log);

  if (decoded.eventName === "NicknameSet") {
    const { user, nickname } = decoded.args as { user: string; nickname: `0x${string}` };
    const buf = Buffer.from(nickname.slice(2), "hex");
    const nullIdx = buf.indexOf(0);
    const nicknameStr = buf.subarray(0, nullIdx === -1 ? buf.length : nullIdx).toString("utf-8");

    hlog.info(
      { event: "NicknameSet", user, nickname: nicknameStr, block: blockNumber },
      "event received",
    );
    await db.query(
      `INSERT INTO nicknames (address, nickname, block_number)
       VALUES ($1, $2, $3)
       ON CONFLICT (address) DO UPDATE SET nickname = $2, block_number = $3`,
      [addrLc(user), nicknameStr, blockNumber],
    );
  }
}

// ============================================================
// Helper: Insert novel from chain state
// ============================================================

async function insertNovelFromChain(
  db: Client,
  rpc: PublicClient,
  novelId: bigint,
  blockNumber: string,
) {
  const [novel, metadata] = (await Promise.all([
    rpc.readContract({
      address: env.NOVEL_CORE_ADDRESS,
      abi: novelCoreAbi,
      functionName: "getNovel",
      args: [novelId],
    }),
    rpc.readContract({
      address: env.NOVEL_CORE_ADDRESS,
      abi: novelCoreAbi,
      functionName: "getNovelMetadata",
      args: [novelId],
    }),
  ])) as [any, any];

  const config = buildConfigJson(novel.config);

  await db.query(
    `INSERT INTO novels (id, creator, title, description, cover_uri, config, current_round,
            round_phase, phase_start_time, last_settle_time, active, block_number, content_location)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11, $12)
     ON CONFLICT (id) DO NOTHING`,
    [
      novelId.toString(),
      addrLc(novel.creator),
      metadata.title,
      metadata.description,
      metadata.coverUri,
      JSON.stringify(config),
      novel.currentRound,
      novel.roundPhase,
      novel.phaseStartTime.toString(),
      novel.lastSettleTime.toString(),
      blockNumber,
      novel.config.contentLocation,
    ],
  );
}

// ============================================================
// Helper: Build config JSON from NovelConfig struct
// ============================================================

function buildConfigJson(config: any): Record<string, unknown> {
  return {
    minChapterLength: config.minChapterLength.toString(),
    maxChapterLength: config.maxChapterLength.toString(),
    submissionFee: config.submissionFee.toString(),
    worldLineCount: config.worldLineCount,
    voteStake: config.voteStake.toString(),
    nominationFee: config.nominationFee.toString(),
    nominateDuration: config.nominateDuration.toString(),
    commitDuration: config.commitDuration.toString(),
    revealDuration: config.revealDuration.toString(),
    minRoundGap: config.minRoundGap.toString(),
    prizeReleaseRate: config.prizeReleaseRate,
    voterRewardRate: config.voterRewardRate,
    contentLocation: config.contentLocation,
    contentBaseUrl: config.contentBaseUrl,
    ruleFee: config.ruleFee.toString(),
    ruleVoteDuration: config.ruleVoteDuration.toString(),
    ruleQuorum: config.ruleQuorum,
  };
}

// ============================================================
// Helper: Get block timestamp
// ============================================================

async function getBlockTimestamp(rpc: PublicClient, blockNumber: bigint | null): Promise<string> {
  if (!blockNumber) return Math.floor(Date.now() / 1000).toString();
  const block = await rpc.getBlock({ blockNumber });
  return block.timestamp.toString();
}

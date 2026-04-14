import type pg from "pg";
import { type Log, type PublicClient, decodeEventLog, decodeFunctionData } from "viem";
import {
  novelCoreAbi,
  roundManagerAbi,
  votingEngineAbi,
  prizePoolAbi,
  bountyBoardAbi,
  rulesEngineAbi,
  userRegistryAbi,
} from "../utils/abi.js";
import { env } from "../utils/env.js";
import { ContentLocation } from "../utils/validate.js";
import { fetchChapterContent } from "./content-fetcher.js";
import { signalKeeper, type KeeperSignalBuffer } from "../keeper/index.js";

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
  let decoded;
  try {
    decoded = decodeEventLog({ abi: novelCoreAbi, data: log.data, topics: log.topics });
  } catch {
    return;
  }

  const blockNumber = log.blockNumber?.toString() ?? "0";
  const handlerStart = Date.now();

  switch (decoded.eventName) {
    case "NovelCreated":
    case "NovelForked": {
      const { novelId } = decoded.args;
      console.log(`[event] ${decoded.eventName} novelId=${novelId} block=${blockNumber}`);
      await insertNovelFromChain(db, rpc, novelId, blockNumber);
      console.log(`[event] ${decoded.eventName} novelId=${novelId} done in ${Date.now() - handlerStart}ms`);
      break;
    }

    case "ChapterSubmitted": {
      const { novelId, chapterId, author, parentId, depth } = decoded.args;
      console.log(
        `[event] ChapterSubmitted chapterId=${chapterId} novelId=${novelId} author=${author} block=${blockNumber}`,
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
          author,
          chapter.contentHash,
          chapter.declaredLength.toString(),
          depth,
          chapter.timestamp.toString(),
          depth === 1,
          blockNumber,
        ],
      );

      await db.query("UPDATE novels SET last_chapter_at = NOW() WHERE id = $1", [novelId.toString()]);

      // Content decoding
      const novelRes = await db.query("SELECT content_location FROM novels WHERE id = $1", [novelId.toString()]);
      if (novelRes.rows.length > 0 && novelRes.rows[0].content_location === ContentLocation.Onchain) {
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
          console.error(`Failed to decode calldata for chapter ${chapterId}:`, err);
        }
      } else {
        fetchChapterContent(chapterId, novelId).catch((err) =>
          console.error(`Content fetch failed for chapter ${chapterId}:`, err),
        );
      }
      console.log(`[event] ChapterSubmitted chapterId=${chapterId} done in ${Date.now() - handlerStart}ms`);
      signalKeeper(novelId, keeperBuf);
      break;
    }

    case "NovelMetadataUpdated": {
      const { novelId, title, description, coverUri } = decoded.args;
      await db.query(
        "UPDATE novels SET title = $1, description = $2, cover_uri = $3 WHERE id = $4",
        [title, description, coverUri, novelId.toString()],
      );
      break;
    }

    case "RewardClaimed": {
      // Prize-pool-side claim; PrizePool.RewardClaimed handler inserts into reward_claims.
      // No-op here to avoid duplicates.
      break;
    }
  }
}

// ============================================================
// RoundManager Event Handler — round lifecycle, voting, completion
// ============================================================

export async function handleRoundManagerEvent(
  log: Log,
  db: Client,
  rpc: PublicClient,
  keeperBuf: KeeperSignalBuffer | null = null,
) {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: roundManagerAbi, data: log.data, topics: log.topics });
  } catch {
    return;
  }

  const blockNumber = log.blockNumber?.toString() ?? "0";

  switch (decoded.eventName) {
    case "RoundStarted": {
      const { novelId, round, candidates } = decoded.args;
      console.log(
        `[event] RoundStarted novelId=${novelId} round=${round} candidates=${candidates.length} block=${blockNumber}`,
      );

      await db.query(
        "UPDATE novels SET current_round = $1, round_phase = 1, phase_start_time = $2 WHERE id = $3",
        [round, await getBlockTimestamp(rpc, log.blockNumber ?? null), novelId.toString()],
      );

      for (let i = 0; i < candidates.length; i++) {
        await db.query(
          `INSERT INTO round_candidates (novel_id, round, chapter_id, position, block_number)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [novelId.toString(), round, candidates[i].toString(), i, blockNumber],
        );
      }

      signalKeeper(novelId, keeperBuf);
      break;
    }

    case "NominationClosed": {
      const { novelId, round } = decoded.args;
      console.log(`[event] NominationClosed novelId=${novelId} round=${round} block=${blockNumber}`);
      await db.query(
        "UPDATE novels SET round_phase = 2, phase_start_time = $1 WHERE id = $2",
        [await getBlockTimestamp(rpc, log.blockNumber ?? null), novelId.toString()],
      );
      signalKeeper(novelId, keeperBuf);
      break;
    }

    case "CommitClosed": {
      const { novelId, round } = decoded.args;
      console.log(`[event] CommitClosed novelId=${novelId} round=${round} block=${blockNumber}`);
      await db.query(
        "UPDATE novels SET round_phase = 3, phase_start_time = $1 WHERE id = $2",
        [await getBlockTimestamp(rpc, log.blockNumber ?? null), novelId.toString()],
      );
      signalKeeper(novelId, keeperBuf);
      break;
    }

    case "RoundSettled": {
      const { novelId, round, worldLines } = decoded.args;
      console.log(
        `[event] RoundSettled novelId=${novelId} round=${round} worldLines=[${worldLines}] block=${blockNumber}`,
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

      signalKeeper(novelId, keeperBuf);
      break;
    }

    case "CandidateNominated": {
      const { novelId, round, chapterId } = decoded.args;
      console.log(
        `[event] CandidateNominated novelId=${novelId} round=${round} chapterId=${chapterId} block=${blockNumber}`,
      );
      break;
    }

    case "VoteCommitted":
    case "VoteRevealed": {
      // Also emitted by VotingEngine with identical data — process there to avoid duplicates.
      if (env.VOTING_ENGINE_ADDRESS) break;
      if (decoded.eventName === "VoteCommitted") {
        const { novelId, round, voter } = decoded.args;
        await db.query(
          `INSERT INTO votes (novel_id, round, voter, commit_block)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [novelId.toString(), round, voter.toLowerCase(), blockNumber],
        );
      } else {
        const { novelId, round, voter, candidateId } = decoded.args;
        await db.query(
          `UPDATE votes SET revealed = TRUE, candidate_id = $1, reveal_block = $2
           WHERE novel_id = $3 AND round = $4 AND LOWER(voter) = LOWER($5)`,
          [candidateId.toString(), blockNumber, novelId.toString(), round, voter],
        );
      }
      break;
    }

    case "NovelCompleted": {
      const { novelId } = decoded.args;
      await db.query("UPDATE novels SET active = FALSE WHERE id = $1", [novelId.toString()]);
      break;
    }

    case "RewardClaimed":
    case "KeeperRewarded": {
      // Tracked via VotingEngine / PrizePool handlers.
      break;
    }
  }
}

// ============================================================
// VotingEngine Event Handler
// ============================================================

export async function handleVotingEvent(log: Log, db: Client) {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: votingEngineAbi, data: log.data, topics: log.topics });
  } catch {
    return;
  }

  const blockNumber = log.blockNumber?.toString() ?? "0";

  switch (decoded.eventName) {
    case "VoteCommitted": {
      const { novelId, round, voter } = decoded.args;
      await db.query(
        `INSERT INTO votes (novel_id, round, voter, commit_block)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [novelId.toString(), round, voter.toLowerCase(), blockNumber],
      );
      break;
    }

    case "VoteRevealed": {
      const { novelId, round, voter, candidateId } = decoded.args;
      await db.query(
        `UPDATE votes SET revealed = TRUE, candidate_id = $1, reveal_block = $2
         WHERE novel_id = $3 AND round = $4 AND LOWER(voter) = LOWER($5)`,
        [candidateId.toString(), blockNumber, novelId.toString(), round, voter],
      );
      break;
    }

    case "VotesTallied": {
      break;
    }

    case "VotingRewardClaimed": {
      const { novelId, round, voter, amount } = decoded.args;
      await db.query(
        "UPDATE votes SET claimed = TRUE WHERE novel_id = $1 AND round = $2 AND LOWER(voter) = LOWER($3)",
        [novelId.toString(), round, voter],
      );
      await db.query(
        "INSERT INTO reward_claims (novel_id, claimant, amount, source, round, block_number) VALUES ($1, $2, $3, 'voting', $4, $5)",
        [novelId.toString(), voter, amount.toString(), round, blockNumber],
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
  let decoded;
  try {
    decoded = decodeEventLog({ abi: prizePoolAbi, data: log.data, topics: log.topics });
  } catch {
    return;
  }

  const blockNumber = log.blockNumber?.toString() ?? "0";

  switch (decoded.eventName) {
    case "PoolDeposited": {
      const { novelId, amount } = decoded.args;
      await db.query(
        "UPDATE novels SET total_funded = total_funded + $1 WHERE id = $2",
        [amount.toString(), novelId.toString()],
      );
      break;
    }

    case "TipReceived": {
      const { novelId, tipper, amount } = decoded.args;
      await db.query(
        "INSERT INTO tips (novel_id, tipper, amount, block_number) VALUES ($1, $2, $3, $4)",
        [novelId.toString(), tipper, amount.toString(), blockNumber],
      );
      await db.query(
        "UPDATE novels SET total_tipped = total_tipped + $1, total_funded = total_funded + $1 WHERE id = $2",
        [amount.toString(), novelId.toString()],
      );
      break;
    }

    case "ChapterTipped": {
      const { novelId, chapterId, tipper, amount } = decoded.args;
      const chapterRes = await db.query("SELECT author FROM chapters WHERE id = $1", [chapterId.toString()]);
      const author = chapterRes.rows[0]?.author ?? "";
      await db.query(
        "INSERT INTO chapter_tips (chapter_id, novel_id, tipper, author, amount, block_number) VALUES ($1, $2, $3, $4, $5, $6)",
        [chapterId.toString(), novelId.toString(), tipper, author, amount.toString(), blockNumber],
      );
      break;
    }

    case "RewardClaimed": {
      const { novelId, recipient, amount } = decoded.args;
      await db.query(
        "INSERT INTO reward_claims (novel_id, claimant, amount, source, block_number) VALUES ($1, $2, $3, 'prize_pool', $4)",
        [novelId.toString(), recipient, amount.toString(), blockNumber],
      );
      break;
    }

    case "RoundRewardsDistributed":
    case "KeeperRewardPaid":
    default:
      break;
  }
}

// ============================================================
// BountyBoard Event Handler
// ============================================================

export async function handleBountyBoardEvent(log: Log, db: Client) {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: bountyBoardAbi, data: log.data, topics: log.topics });
  } catch {
    return;
  }

  const blockNumber = log.blockNumber?.toString() ?? "0";

  switch (decoded.eventName) {
    case "BountyCreated": {
      const { bountyId, chapterId, tipper, lockedAmount, deadline } = decoded.args;
      const chapterRes = await db.query("SELECT novel_id FROM chapters WHERE id = $1", [chapterId.toString()]);
      const novelId = chapterRes.rows[0]?.novel_id ?? "0";
      await db.query(
        `INSERT INTO bounties (id, chapter_id, novel_id, tipper, locked_amount, deadline, block_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          bountyId.toString(),
          chapterId.toString(),
          novelId,
          tipper,
          lockedAmount.toString(),
          deadline.toString(),
          blockNumber,
        ],
      );
      break;
    }

    case "BountyDesignated": {
      const { bountyId, chapterId } = decoded.args;
      console.log(`[event] BountyDesignated bountyId=${bountyId} chapterId=${chapterId}`);
      await db.query(
        "UPDATE bounties SET designated_chapter_id = $1 WHERE id = $2",
        [chapterId.toString(), bountyId.toString()],
      );
      break;
    }

    case "BountyClaimed": {
      const { bountyId: claimedBountyId, author: claimAuthor, amount: claimAmount } = decoded.args;
      console.log(`[event] BountyClaimed bountyId=${claimedBountyId} author=${claimAuthor} amount=${claimAmount}`);
      break;
    }

    case "BountyRefunded": {
      const { bountyId } = decoded.args;
      await db.query("UPDATE bounties SET claimed = TRUE WHERE id = $1", [bountyId.toString()]);
      break;
    }
  }
}

// ============================================================
// RulesEngine Event Handler
// ============================================================

export async function handleRulesEvent(log: Log, db: Client, rpc: PublicClient) {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: rulesEngineAbi, data: log.data, topics: log.topics });
  } catch {
    return;
  }

  const blockNumber = log.blockNumber?.toString() ?? "0";

  switch (decoded.eventName) {
    case "RuleSet": {
      const { novelId, name } = decoded.args;
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
      const { novelId, name } = decoded.args;
      await db.query("DELETE FROM rules WHERE novel_id = $1 AND name = $2", [novelId.toString(), name]);
      break;
    }

    case "RuleProposed": {
      const { proposalId, novelId, proposer, proposalType, ruleName } = decoded.args;
      const proposal = (await rpc.readContract({
        address: env.RULES_ENGINE_ADDRESS,
        abi: rulesEngineAbi,
        functionName: "getRuleProposal",
        args: [proposalId],
      })) as any;
      await db.query(
        `INSERT INTO rule_proposals (id, novel_id, proposer, proposal_type, rule_name, rule_content, created_at_time, vote_count, executed, block_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          proposalId.toString(),
          novelId.toString(),
          proposer,
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
      const { proposalId, voter, newVoteCount } = decoded.args;
      await db.query(
        `INSERT INTO rule_proposal_votes (proposal_id, voter, block_number)
         VALUES ($1, $2, $3)
         ON CONFLICT (proposal_id, voter) DO NOTHING`,
        [proposalId.toString(), voter, blockNumber],
      );
      await db.query(
        "UPDATE rule_proposals SET vote_count = $1 WHERE id = $2",
        [newVoteCount, proposalId.toString()],
      );
      break;
    }

    case "RuleProposalExecuted": {
      const { proposalId } = decoded.args;
      await db.query("UPDATE rule_proposals SET executed = TRUE WHERE id = $1", [proposalId.toString()]);
      break;
    }
  }
}

// ============================================================
// UserRegistry Event Handler — nicknames
// ============================================================

export async function handleUserRegistryEvent(log: Log, db: Client) {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: userRegistryAbi, data: log.data, topics: log.topics });
  } catch {
    return;
  }

  const blockNumber = log.blockNumber?.toString() ?? "0";

  if (decoded.eventName === "NicknameSet") {
    const { user, nickname } = decoded.args;
    const hexStr = nickname as `0x${string}`;
    const buf = Buffer.from(hexStr.slice(2), "hex");
    const nullIdx = buf.indexOf(0);
    const nicknameStr = buf.subarray(0, nullIdx === -1 ? buf.length : nullIdx).toString("utf-8");

    console.log(`[event] NicknameSet user=${user} nickname="${nicknameStr}" block=${blockNumber}`);
    await db.query(
      `INSERT INTO nicknames (address, nickname, block_number)
       VALUES ($1, $2, $3)
       ON CONFLICT (address) DO UPDATE SET nickname = $2, block_number = $3`,
      [user.toLowerCase(), nicknameStr, blockNumber],
    );
  }
}

// ============================================================
// Helper: Insert novel from chain state
// ============================================================

async function insertNovelFromChain(db: Client, rpc: PublicClient, novelId: bigint, blockNumber: string) {
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
      novel.creator,
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

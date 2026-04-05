import type pg from "pg";
import { type Log, type PublicClient, decodeEventLog, decodeFunctionData, formatEther } from "viem";
import { novelCoreAbi, votingEngineAbi, prizePoolAbi, chapterNFTAbi } from "../utils/abi.js";
import { env } from "../utils/env.js";
import { ContentLocation } from "../utils/validate.js";
import { fetchChapterContent } from "./content-fetcher.js";
import { createNotification, createRevealReminders } from "../utils/notifications.js";

type Client = pg.PoolClient;

async function getBlockTimestamp(rpc: PublicClient, blockNumber: bigint | null): Promise<string> {
  if (!blockNumber) return Math.floor(Date.now() / 1000).toString();
  const block = await rpc.getBlock({ blockNumber });
  return block.timestamp.toString();
}

export async function handleNovelCoreEvent(log: Log, db: Client, rpc: PublicClient) {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: novelCoreAbi, data: log.data, topics: log.topics });
  } catch {
    return; // Not a recognized event
  }

  const blockNumber = log.blockNumber?.toString() ?? "0";
  const handlerStart = Date.now();

  switch (decoded.eventName) {
    case "NovelCreated": {
      const { novelId, creator, genesisChapterCount } = decoded.args;
      console.log(`[event] NovelCreated novelId=${novelId} creator=${creator} genesis=${genesisChapterCount} block=${blockNumber}`);
      // Fetch full novel data + metadata from chain
      const [novel, metadata] = await Promise.all([
        rpc.readContract({ address: env.NOVEL_CORE_ADDRESS, abi: novelCoreAbi, functionName: "getNovel", args: [novelId] }),
        rpc.readContract({ address: env.NOVEL_CORE_ADDRESS, abi: novelCoreAbi, functionName: "getNovelMetadata", args: [novelId] }),
      ]) as [any, any];

      const config = {
        minChapterLength: novel.config.minChapterLength.toString(),
        maxChapterLength: novel.config.maxChapterLength.toString(),
        roundMinDuration: novel.config.roundMinDuration.toString(),
        roundMinSubmissions: novel.config.roundMinSubmissions,
        worldLineCount: novel.config.worldLineCount,
        roundsPerEpoch: novel.config.roundsPerEpoch,
        prizeReleaseRate: novel.config.prizeReleaseRate,
        voterRewardRate: novel.config.voterRewardRate,
        commitDuration: novel.config.commitDuration.toString(),
        revealDuration: novel.config.revealDuration.toString(),
        stakeAmount: novel.config.stakeAmount.toString(),
        spamRounds: novel.config.spamRounds,
        spamThreshold: novel.config.spamThreshold,
        contentLocation: novel.config.contentLocation,
        contentBaseUrl: novel.config.contentBaseUrl,
      };

      await db.query(
        `INSERT INTO novels (id, creator, title, description, cover_uri, config, current_round, current_epoch, round_phase, epoch_phase, phase_start_time, genesis_chapter_count, active, block_number, content_location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, $13, $14)
         ON CONFLICT (id) DO NOTHING`,
        [
          novelId.toString(), creator, metadata.title, metadata.description, metadata.coverUri,
          JSON.stringify(config), novel.currentRound, novel.currentEpoch,
          novel.roundPhase, novel.epochPhase, novel.phaseStartTime.toString(),
          genesisChapterCount, blockNumber, novel.config.contentLocation,
        ]
      );

      // Index genesis chapters
      for (let i = 1n; i <= BigInt(genesisChapterCount); i++) {
        const chapterId = novelId === 1n ? i : undefined; // Need to figure out actual IDs
      }
      // Genesis chapters are also emitted as separate events or we need to fetch them
      // They'll be picked up via the chain state after NovelCreated
      await indexGenesisChapters(novelId, genesisChapterCount, blockNumber, db, rpc, log);
      console.log(`[event] NovelCreated novelId=${novelId} done in ${Date.now() - handlerStart}ms`);
      break;
    }

    case "NovelForked": {
      const { novelId, sourceNovelId, sourceChapterId } = decoded.args;
      console.log(`[event] NovelForked novelId=${novelId} source=${sourceNovelId}#${sourceChapterId} block=${blockNumber}`);
      const [novel, metadata] = await Promise.all([
        rpc.readContract({ address: env.NOVEL_CORE_ADDRESS, abi: novelCoreAbi, functionName: "getNovel", args: [novelId] }),
        rpc.readContract({ address: env.NOVEL_CORE_ADDRESS, abi: novelCoreAbi, functionName: "getNovelMetadata", args: [novelId] }),
      ]) as [any, any];

      const config = {
        minChapterLength: novel.config.minChapterLength.toString(),
        maxChapterLength: novel.config.maxChapterLength.toString(),
        roundMinDuration: novel.config.roundMinDuration.toString(),
        roundMinSubmissions: novel.config.roundMinSubmissions,
        worldLineCount: novel.config.worldLineCount,
        roundsPerEpoch: novel.config.roundsPerEpoch,
        prizeReleaseRate: novel.config.prizeReleaseRate,
        voterRewardRate: novel.config.voterRewardRate,
        commitDuration: novel.config.commitDuration.toString(),
        revealDuration: novel.config.revealDuration.toString(),
        stakeAmount: novel.config.stakeAmount.toString(),
        spamRounds: novel.config.spamRounds,
        spamThreshold: novel.config.spamThreshold,
        contentLocation: novel.config.contentLocation,
        contentBaseUrl: novel.config.contentBaseUrl,
      };

      await db.query(
        `INSERT INTO novels (id, creator, title, description, cover_uri, config, current_round, current_epoch, round_phase, epoch_phase, phase_start_time, genesis_chapter_count, active, fork_source_novel_id, fork_source_chapter_id, block_number, content_location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, $13, $14, $15, $16)
         ON CONFLICT (id) DO NOTHING`,
        [
          novelId.toString(), novel.creator, metadata.title, metadata.description, metadata.coverUri,
          JSON.stringify(config), novel.currentRound, novel.currentEpoch,
          novel.roundPhase, novel.epochPhase, novel.phaseStartTime.toString(),
          novel.genesisChapterCount, sourceNovelId.toString(), sourceChapterId.toString(), blockNumber,
          novel.config.contentLocation,
        ]
      );
      break;
    }

    case "NovelCompleted": {
      const { novelId } = decoded.args;
      await db.query("UPDATE novels SET active = FALSE WHERE id = $1", [novelId.toString()]);
      break;
    }

    case "ChapterSubmitted": {
      const { novelId, chapterId, author, parentId, chapterIndex } = decoded.args;
      console.log(`[event] ChapterSubmitted chapterId=${chapterId} novelId=${novelId} author=${author} block=${blockNumber}`);
      // Fetch full chapter data
      const chapter = await rpc.readContract({
        address: env.NOVEL_CORE_ADDRESS, abi: novelCoreAbi,
        functionName: "getChapter", args: [chapterId],
      }) as any;

      await db.query(
        `INSERT INTO chapters (id, novel_id, parent_id, author, content_hash, declared_length, round, epoch, chapter_index, vote_count, is_world_line, is_canon, block_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO NOTHING`,
        [
          chapterId.toString(), novelId.toString(), parentId.toString(),
          author, chapter.contentHash, chapter.declaredLength.toString(),
          chapter.round, chapter.epoch, chapterIndex,
          "0", chapter.isWorldLine, chapter.isCanon, blockNumber,
        ]
      );

      await db.query("UPDATE novels SET last_chapter_at = NOW() WHERE id = $1", [novelId.toString()]);

      // For onchain content, decode from tx calldata; for external, fetch from URL
      const novelRes = await db.query("SELECT content_location FROM novels WHERE id = $1", [novelId.toString()]);
      if (novelRes.rows.length > 0 && novelRes.rows[0].content_location === ContentLocation.Onchain) {
        // Onchain: extract content from transaction calldata
        try {
          const tx = await rpc.getTransaction({ hash: log.transactionHash! });
          const { args } = decodeFunctionData({ abi: novelCoreAbi, data: tx.input });
          const submission = (args as any)[2]; // 3rd arg: ContentSubmission
          const contentBytes = submission.content as `0x${string}`;
          const textContent = Buffer.from(contentBytes.slice(2), "hex").toString("utf-8");
          await db.query(
            "UPDATE chapters SET content_text = $1, content_fetched = TRUE WHERE id = $2",
            [textContent, chapterId.toString()]
          );
        } catch (err) {
          console.error(`Failed to decode calldata for chapter ${chapterId}:`, err);
        }
      } else {
        // External/HTTP: async content fetch
        fetchChapterContent(chapterId, novelId).catch(err =>
          console.error(`Content fetch failed for chapter ${chapterId}:`, err)
        );
      }
      console.log(`[event] ChapterSubmitted chapterId=${chapterId} done in ${Date.now() - handlerStart}ms`);
      break;
    }

    case "RoundPhaseChanged": {
      const { novelId, round, phase } = decoded.args;
      const roundPhaseTimestamp = await getBlockTimestamp(rpc, log.blockNumber ?? null);
      await db.query(
        "UPDATE novels SET current_round = $1, round_phase = $2, phase_start_time = $3 WHERE id = $4",
        [round, phase, roundPhaseTimestamp, novelId.toString()]
      );

      // Fetch novel title for notification
      const novelRow = await db.query("SELECT title FROM novels WHERE id = $1", [novelId.toString()]);
      const novelTitle = novelRow.rows[0]?.title || `Novel #${novelId}`;
      const phaseNames = ["Submitting", "Committing", "Revealing", "Settling"];
      const phaseName = phaseNames[phase] || `Phase ${phase}`;

      // Broadcast phase change notification
      await createNotification(db, {
        recipient: null,
        novelId: novelId.toString(),
        type: "phase_change",
        title: `${novelTitle} — Round ${round}`,
        message: `Phase changed to ${phaseName}.`,
        link: `/novels/${novelId}`,
      });

      // If entering Revealing phase, create reveal reminders for committed voters
      if (phase === 2) {
        // Need to find the votingRoundId — we query votes for this novel that are unrevealed
        const unrevealed = await db.query(
          "SELECT DISTINCT voter, voting_round_id FROM votes WHERE novel_id = $1 AND revealed = FALSE AND claimed = FALSE",
          [novelId.toString()]
        );
        for (const row of unrevealed.rows) {
          await createNotification(db, {
            recipient: row.voter,
            novelId: novelId.toString(),
            type: "reveal_reminder",
            title: "Reveal your vote!",
            message: `Round ${round} of "${novelTitle}" has entered the reveal phase. Reveal your vote to avoid losing your stake.`,
            link: `/novels/${novelId}`,
          });
        }
      }
      break;
    }

    case "EpochPhaseChanged": {
      const { novelId, epoch, phase } = decoded.args;
      const epochPhaseTimestamp = await getBlockTimestamp(rpc, log.blockNumber ?? null);
      await db.query(
        "UPDATE novels SET current_epoch = $1, epoch_phase = $2, phase_start_time = $3 WHERE id = $4",
        [epoch, phase, epochPhaseTimestamp, novelId.toString()]
      );

      const novelRow2 = await db.query("SELECT title FROM novels WHERE id = $1", [novelId.toString()]);
      const novelTitle2 = novelRow2.rows[0]?.title || `Novel #${novelId}`;
      const epochPhaseNames = ["Rounds", "Committing", "Revealing", "Settling"];
      const epochPhaseName = epochPhaseNames[phase] || `Phase ${phase}`;

      await createNotification(db, {
        recipient: null,
        novelId: novelId.toString(),
        type: "phase_change",
        title: `${novelTitle2} — Epoch ${epoch}`,
        message: `Epoch phase changed to ${epochPhaseName}.`,
        link: `/novels/${novelId}`,
      });

      // Epoch Revealing phase → remind epoch voters to reveal
      if (phase === 2) {
        const unrevealed2 = await db.query(
          "SELECT DISTINCT voter, voting_round_id FROM votes WHERE novel_id = $1 AND revealed = FALSE AND claimed = FALSE",
          [novelId.toString()]
        );
        for (const row of unrevealed2.rows) {
          await createNotification(db, {
            recipient: row.voter,
            novelId: novelId.toString(),
            type: "reveal_reminder",
            title: "Reveal your epoch vote!",
            message: `Epoch ${epoch} of "${novelTitle2}" has entered the reveal phase. Reveal now or lose your stake.`,
            link: `/novels/${novelId}`,
          });
        }
      }
      break;
    }

    case "WorldLinesSelected": {
      const { novelId, round, selectedChapterIds } = decoded.args;
      console.log(`[event] WorldLinesSelected novelId=${novelId} round=${round} selected=[${selectedChapterIds}] block=${blockNumber}`);
      // Reset ALL world line flags for this novel (previous rounds + current), then mark new ones
      await db.query(
        "UPDATE chapters SET is_world_line = FALSE WHERE novel_id = $1 AND is_world_line = TRUE",
        [novelId.toString()]
      );
      for (const id of selectedChapterIds) {
        await db.query("UPDATE chapters SET is_world_line = TRUE WHERE id = $1", [id.toString()]);
      }
      break;
    }

    case "CanonEstablished": {
      const { novelId, epoch, canonWorldLineId } = decoded.args;
      console.log(`[event] CanonEstablished novelId=${novelId} epoch=${epoch} canonId=${canonWorldLineId} block=${blockNumber}`);
      await traceAndMarkCanon(canonWorldLineId, db, rpc);

      // Epoch settle resets active world lines to canon only — clear all, set canon
      await db.query(
        "UPDATE chapters SET is_world_line = FALSE WHERE novel_id = $1 AND is_world_line = TRUE",
        [novelId.toString()]
      );
      await db.query(
        "UPDATE chapters SET is_world_line = TRUE WHERE id = $1",
        [canonWorldLineId.toString()]
      );

      const novel = await rpc.readContract({
        address: env.NOVEL_CORE_ADDRESS, abi: novelCoreAbi,
        functionName: "getNovel", args: [novelId],
      }) as any;
      await db.query(
        "UPDATE novels SET cumulative_canon_chapters = $1 WHERE id = $2",
        [novel.cumulativeCanonChapters, novelId.toString()]
      );

      const novelRow3 = await db.query("SELECT title FROM novels WHERE id = $1", [novelId.toString()]);
      const novelTitle3 = novelRow3.rows[0]?.title || `Novel #${novelId}`;
      await createNotification(db, {
        recipient: null,
        novelId: novelId.toString(),
        type: "canon_established",
        title: `Canon established — ${novelTitle3}`,
        message: `Epoch ${epoch} canon has been established. New chapter NFTs minted and rewards distributed.`,
        link: `/novels/${novelId}/canon`,
      });
      break;
    }

    case "NovelMetadataUpdated": {
      const { novelId, title, description, coverUri } = decoded.args;
      await db.query(
        "UPDATE novels SET title = $1, description = $2, cover_uri = $3 WHERE id = $4",
        [title, description, coverUri, novelId.toString()]
      );
      break;
    }

    case "StakeRefunded": {
      const { novelId, author, amount } = decoded.args;
      await db.query(
        "INSERT INTO stake_events (novel_id, author, event_type, amount, block_number) VALUES ($1, $2, 'refunded', $3, $4)",
        [novelId.toString(), author, amount.toString(), blockNumber]
      );
      break;
    }

    case "StakeSlashed": {
      const { novelId, author, amount } = decoded.args;
      await db.query(
        "INSERT INTO stake_events (novel_id, author, event_type, amount, block_number) VALUES ($1, $2, 'slashed', $3, $4)",
        [novelId.toString(), author, amount.toString(), blockNumber]
      );
      break;
    }

    case "EarlyEpochTriggered":
    case "KeeperRewarded":
      break;
  }
}

async function indexGenesisChapters(novelId: bigint, count: number, blockNumber: string, db: Client, rpc: PublicClient, log: Log) {
  const t0 = Date.now();
  // Genesis chapters are created before any ChapterSubmitted events.
  // We fetch them via getActiveWorldLines to find their IDs.
  const worldLines = await rpc.readContract({
    address: env.NOVEL_CORE_ADDRESS, abi: novelCoreAbi,
    functionName: "getActiveWorldLines", args: [novelId],
  }) as bigint[];

  // Try to decode genesis content from createNovel calldata
  let genesisContents: string[] | null = null;
  const novelRes = await db.query("SELECT content_location FROM novels WHERE id = $1", [novelId.toString()]);
  const isOnchain = novelRes.rows.length > 0 && novelRes.rows[0].content_location === ContentLocation.Onchain;

  if (isOnchain && log.transactionHash) {
    try {
      const tx = await rpc.getTransaction({ hash: log.transactionHash });
      const { args } = decodeFunctionData({ abi: novelCoreAbi, data: tx.input });
      const genesisChapters = (args as any)[2] as any[]; // 3rd arg: ContentSubmission[]
      genesisContents = genesisChapters.map((sub: any) => {
        const contentBytes = sub.content as `0x${string}`;
        return Buffer.from(contentBytes.slice(2), "hex").toString("utf-8");
      });
    } catch (err) {
      console.error(`Failed to decode createNovel calldata for novel ${novelId}:`, err);
    }
  }

  for (let i = 0; i < worldLines.length; i++) {
    const chapterId = worldLines[i];
    const chapter = await rpc.readContract({
      address: env.NOVEL_CORE_ADDRESS, abi: novelCoreAbi,
      functionName: "getChapter", args: [chapterId],
    }) as any;

    await db.query(
      `INSERT INTO chapters (id, novel_id, parent_id, author, content_hash, declared_length, round, epoch, chapter_index, vote_count, is_world_line, is_canon, block_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO NOTHING`,
      [
        chapterId.toString(), novelId.toString(), chapter.parentId.toString(),
        chapter.author, chapter.contentHash, chapter.declaredLength.toString(),
        chapter.round, chapter.epoch, chapter.chapterIndex,
        "0", chapter.isWorldLine, chapter.isCanon, blockNumber,
      ]
    );

    if (isOnchain && genesisContents && i < genesisContents.length) {
      await db.query(
        "UPDATE chapters SET content_text = $1, content_fetched = TRUE WHERE id = $2",
        [genesisContents[i], chapterId.toString()]
      );
      console.log(`[genesis] Chapter ${chapterId} content stored (${genesisContents[i].length} chars)`);
    } else if (!isOnchain) {
      fetchChapterContent(chapterId, novelId).catch(err =>
        console.error(`Content fetch failed for genesis chapter ${chapterId}:`, err)
      );
    }
  }
  console.log(`[genesis] Indexed ${worldLines.length} genesis chapters for novel ${novelId} in ${Date.now() - t0}ms`);
}

async function traceAndMarkCanon(chapterId: bigint, db: Client, rpc: PublicClient) {
  let currentId = chapterId;
  while (currentId > 0n) {
    await db.query("UPDATE chapters SET is_canon = TRUE WHERE id = $1", [currentId.toString()]);
    const chapter = await rpc.readContract({
      address: env.NOVEL_CORE_ADDRESS, abi: novelCoreAbi,
      functionName: "getChapter", args: [currentId],
    }) as any;
    currentId = chapter.parentId;
  }
}

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
      const { novelId, votingRoundId, voter } = decoded.args;
      const voterLower = voter.toLowerCase();
      await db.query(
        `INSERT INTO votes (novel_id, voting_round_id, voter, commit_block)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [novelId.toString(), votingRoundId.toString(), voterLower, blockNumber]
      );
      break;
    }
    case "VoteRevealed": {
      const { novelId, votingRoundId, voter, candidateId } = decoded.args;
      await db.query(
        `UPDATE votes SET revealed = TRUE, candidate_id = $1, reveal_block = $2
         WHERE novel_id = $3 AND voting_round_id = $4 AND LOWER(voter) = LOWER($5)`,
        [candidateId.toString(), blockNumber, novelId.toString(), votingRoundId.toString(), voter]
      );
      break;
    }
    case "VotesTallied": {
      const { novelId, votingRoundId, rankedCandidateIds } = decoded.args;
      for (const candidateId of rankedCandidateIds) {
        const res = await db.query(
          "SELECT COUNT(*) as cnt FROM votes WHERE novel_id = $1 AND voting_round_id = $2 AND candidate_id = $3 AND revealed = TRUE",
          [novelId.toString(), votingRoundId.toString(), candidateId.toString()]
        );
        await db.query("UPDATE chapters SET vote_count = $1 WHERE id = $2", [res.rows[0].cnt, candidateId.toString()]);
      }
      break;
    }
    case "VotingRewardClaimed": {
      const { novelId, votingRoundId, voter, totalAmount } = decoded.args;
      await db.query(
        "UPDATE votes SET claimed = TRUE WHERE novel_id = $1 AND voting_round_id = $2 AND LOWER(voter) = LOWER($3)",
        [novelId.toString(), votingRoundId.toString(), voter]
      );
      await db.query(
        "INSERT INTO reward_claims (novel_id, claimant, amount, source, voting_round_id, block_number) VALUES ($1, $2, $3, 'voting', $4, $5)",
        [novelId.toString(), voter, totalAmount.toString(), votingRoundId.toString(), blockNumber]
      );
      break;
    }
    default:
      break;
  }
}

export async function handlePrizePoolEvent(log: Log, db: Client) {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: prizePoolAbi, data: log.data, topics: log.topics });
  } catch {
    return;
  }

  const blockNumber = log.blockNumber?.toString() ?? "0";

  switch (decoded.eventName) {
    case "TipReceived": {
      const { novelId, tipper, amount, timestamp } = decoded.args;
      await db.query(
        "INSERT INTO tips (novel_id, tipper, amount, block_timestamp, block_number) VALUES ($1, $2, $3, $4, $5)",
        [novelId.toString(), tipper, amount.toString(), timestamp.toString(), blockNumber]
      );
      await db.query(
        "UPDATE novels SET total_tipped = total_tipped + $1, total_funded = total_funded + $1 WHERE id = $2",
        [amount.toString(), novelId.toString()]
      );
      break;
    }
    case "RewardClaimed": {
      const { novelId, claimant, amount } = decoded.args;
      await db.query(
        "INSERT INTO reward_claims (novel_id, claimant, amount, source, block_number) VALUES ($1, $2, $3, 'prize_pool', $4)",
        [novelId.toString(), claimant, amount.toString(), blockNumber]
      );
      break;
    }
    default:
      break;
  }
}

export async function handleNFTEvent(log: Log, db: Client) {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: chapterNFTAbi, data: log.data, topics: log.topics });
  } catch {
    return;
  }

  if (decoded.eventName === "ChapterNFTMinted") {
    const { tokenId, novelId, chapterId, author, epoch } = decoded.args;
    await db.query(
      "INSERT INTO chapter_nfts (token_id, novel_id, chapter_id, author, epoch, block_number) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (token_id) DO NOTHING",
      [tokenId.toString(), novelId.toString(), chapterId.toString(), author, epoch, log.blockNumber?.toString() ?? "0"]
    );
  }
}

import type pg from "pg";
import type { PublicClient } from "viem";

import { createLogger } from "../utils/logger.js";

const log = createLogger("indexer:reorg");

/**
 * Tables that hold indexed on-chain data and carry a `block_number` column.
 * On reorg rollback, rows with `block_number > safeBlock` are deleted. Novel
 * state (phase / round / ancestors) is NOT deleted in-place; instead we rewind
 * the indexer checkpoint and replay events, which naturally UPSERT fresh state.
 */
const ROLLBACK_TABLES = [
  "chapters",
  "votes",
  "round_candidates",
  "round_rewards",
  "keeper_rewards",
  "tips",
  "chapter_tips",
  "reward_claims",
  "bounties",
  "bounty_claims",
  "rules",
  "rule_proposals",
  "rule_proposal_votes",
  "nicknames",
] as const;

// Defense-in-depth: even though ROLLBACK_TABLES is a hardcoded const, the rollback loop
// interpolates table names directly into SQL (pg can't parameterize identifiers). Asserting
// each name against this set ensures any future drift can never become an injection vector.
const ROLLBACK_TABLE_SET: ReadonlySet<string> = new Set(ROLLBACK_TABLES);

/**
 * For `votes` the "creation" block is `commit_block`. Purge rows whose commit_block exceeds
 * safeBlock, and downgrade rows whose reveal_block exceeds safeBlock back to unrevealed.
 */
async function rollbackVotes(db: pg.PoolClient, safeBlock: bigint): Promise<number> {
  const delRes = await db.query("DELETE FROM votes WHERE commit_block > $1", [
    safeBlock.toString(),
  ]);
  await db.query(
    `UPDATE votes SET revealed = FALSE, candidate_id = NULL, reveal_block = NULL, claimed = FALSE
     WHERE reveal_block > $1`,
    [safeBlock.toString()],
  );
  return delRes.rowCount ?? 0;
}

/**
 * Rewind on-chain indexed state to the given safe block. Rows with block_number > safeBlock
 * are deleted. The caller must also reset `indexer_state.last_block` and re-process events
 * from the safe block forward.
 *
 * Novel round-phase / metadata mutations are not reversed in place — replay of events onto
 * the surviving row re-establishes consistent state (all handlers use UPDATE/UPSERT).
 */
export async function rollbackToBlock(db: pg.PoolClient, safeBlock: bigint): Promise<void> {
  log.warn({ safeBlock: safeBlock.toString() }, "reorg rollback starting");
  for (const t of ROLLBACK_TABLES) {
    if (t === "votes") {
      const n = await rollbackVotes(db, safeBlock);
      if (n > 0) log.warn({ table: t, deleted: n }, "reorg rollback");
      continue;
    }
    if (!ROLLBACK_TABLE_SET.has(t)) {
      throw new Error(`reorg rollback: table ${t} is not in the whitelist`);
    }
    const res = await db.query(`DELETE FROM ${t} WHERE block_number > $1`, [safeBlock.toString()]);
    if ((res.rowCount ?? 0) > 0) {
      log.warn({ table: t, deleted: res.rowCount }, "reorg rollback");
    }
  }
  await db.query(
    `UPDATE indexer_state SET last_block = $1, last_confirmed_block = $1, last_block_hash = NULL, updated_at = NOW() WHERE id = 1`,
    [safeBlock.toString()],
  );
  log.warn({ safeBlock: safeBlock.toString() }, "reorg rollback complete");
}

/**
 * Verify that the indexer's last-seen block still has the same hash on the current canonical
 * chain. Returns:
 *   - `"ok"` if hash matches or no prior hash was recorded;
 *   - `"reorg"` if a divergence was detected and caller should trigger rollback.
 */
export async function detectReorg(
  client: PublicClient,
  lastBlock: bigint,
  lastBlockHash: string | null,
): Promise<"ok" | "reorg"> {
  if (lastBlock === 0n || !lastBlockHash) return "ok";
  try {
    const block = await client.getBlock({ blockNumber: lastBlock });
    if (block.hash !== lastBlockHash) {
      log.warn(
        {
          block: lastBlock.toString(),
          expected: lastBlockHash,
          actual: block.hash,
        },
        "reorg detected: block hash mismatch",
      );
      return "reorg";
    }
  } catch (err) {
    log.error({ err, block: lastBlock.toString() }, "reorg detection RPC failed; treating as ok");
  }
  return "ok";
}

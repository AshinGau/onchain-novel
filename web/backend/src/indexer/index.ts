import type pg from "pg";
import { type Log, type PublicClient } from "viem";

import { getClient, query } from "../db/index.js";
import { KeeperSignalBuffer } from "../keeper/index.js";
import { env } from "../utils/env.js";
import { createLogger } from "../utils/logger.js";
import { createRpcPublicClient } from "../utils/viem-client.js";
import {
  handleBountyBoardEvent,
  handleNovelCoreEvent,
  handlePrizePoolEvent,
  handleRoundManagerEvent,
  handleRulesEvent,
  handleUserRegistryEvent,
  handleVotingEvent,
} from "./handlers.js";
import { detectReorg, rollbackToBlock } from "./reorg.js";

const ilog = createLogger("indexer");

let currentRpcIndex = 0;
const allRpcUrls = [env.RPC_URL, ...env.RPC_FALLBACK_URLS];

function rotateRpc() {
  currentRpcIndex = (currentRpcIndex + 1) % allRpcUrls.length;
  ilog.info({ rpcIndex: currentRpcIndex, url: allRpcUrls[currentRpcIndex] }, "Rotated RPC");
}

function createClient(): PublicClient {
  return createRpcPublicClient(allRpcUrls[currentRpcIndex]);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getIndexerState(): Promise<{
  lastBlock: bigint;
  lastBlockHash: string | null;
  batchSize: number;
}> {
  const res = await query(
    "SELECT last_block, last_block_hash, batch_size FROM indexer_state WHERE id = 1",
  );
  const row = res.rows[0];
  return {
    lastBlock: BigInt(row.last_block),
    lastBlockHash: row.last_block_hash,
    batchSize: row.batch_size,
  };
}

async function adjustBatchSize(newSize: number) {
  await query("UPDATE indexer_state SET batch_size = $1 WHERE id = 1", [newSize]);
}

interface FetchResult {
  logs: Log[];
  endBlock: bigint;
  endBlockHash: string | null;
  client: PublicClient; // May differ from input if RPC was rotated
}

async function fetchLogs(
  client: PublicClient,
  fromBlock: bigint,
  toBlock: bigint,
  addresses: `0x${string}`[],
): Promise<Log[]> {
  return client.getLogs({
    address: addresses,
    fromBlock,
    toBlock,
  });
}

async function fetchBatchWithRetry(
  client: PublicClient,
  fromBlock: bigint,
  batchSize: number,
  chainHead: bigint,
  addresses: `0x${string}`[],
): Promise<FetchResult> {
  let currentClient = client;
  let currentBatchSize = batchSize;
  let retries = 0;
  const maxRetries = 10;

  while (retries < maxRetries) {
    const toBlock =
      fromBlock + BigInt(currentBatchSize) - 1n > chainHead
        ? chainHead
        : fromBlock + BigInt(currentBatchSize) - 1n;

    try {
      const logs = await fetchLogs(currentClient, fromBlock, toBlock, addresses);
      const block = await currentClient.getBlock({ blockNumber: toBlock });

      // Restore batch size if we had shrunk it
      if (currentBatchSize < batchSize) {
        await adjustBatchSize(currentBatchSize);
      }

      return { logs, endBlock: toBlock, endBlockHash: block.hash, client: currentClient };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      retries++;

      if (msg.includes("429") || msg.includes("rate limit")) {
        const delay = Math.min(1000 * Math.pow(2, retries), 60000);
        ilog.warn({ delay, retries, maxRetries }, "Rate limited, waiting");
        await sleep(delay);
      } else if (msg.includes("range") || msg.includes("block range") || msg.includes("too many")) {
        currentBatchSize = Math.max(10, Math.floor(currentBatchSize / 2));
        ilog.warn({ batchSize: currentBatchSize }, "Range too wide, reducing batch");
      } else if (
        msg.includes("timeout") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("network")
      ) {
        const delay = Math.min(1000 * Math.pow(2, retries), 60000);
        ilog.warn({ delay, retries, maxRetries }, "Network error, waiting");
        if (allRpcUrls.length > 1) rotateRpc();
        await sleep(delay);
        currentClient = createClient();
      } else {
        ilog.error({ msg }, "Unexpected error fetching logs");
        const delay = Math.min(1000 * Math.pow(2, retries), 60000);
        await sleep(delay);
      }
    }
  }

  throw new Error(`Failed to fetch logs after ${maxRetries} retries from block ${fromBlock}`);
}

async function processBatch(
  logs: Log[],
  endBlock: bigint,
  endBlockHash: string | null,
  client: PublicClient,
) {
  const dbClient = await getClient();
  // Buffer keeper signals during the transaction; flush only on successful COMMIT
  // so workers read committed DB state.
  const keeperBuf = new KeeperSignalBuffer();
  try {
    await dbClient.query("BEGIN");

    for (const log of logs) {
      try {
        await processLog(log, dbClient, client, keeperBuf);
      } catch (err) {
        // Log and skip individual event failures to avoid rolling back the entire batch
        const topic0 = log.topics[0]?.slice(0, 10) ?? "unknown";
        const errMsg = err instanceof Error ? err.message : String(err);
        // shadowed `log` here refers to the viem Log; use module logger
        ilog.error(
          { topic0, block: log.blockNumber, tx: log.transactionHash, err: errMsg },
          "Event processing failed",
        );
      }
    }

    await dbClient.query(
      "UPDATE indexer_state SET last_block = $1, last_block_hash = $2, last_confirmed_block = $1, updated_at = NOW() WHERE id = 1",
      [endBlock.toString(), endBlockHash],
    );

    await dbClient.query("COMMIT");

    // DB now reflects all events; safe to wake up keeper.
    keeperBuf.flush();
  } catch (err) {
    await dbClient.query("ROLLBACK");
    // Discard buffered signals — events were not committed.
    throw err;
  } finally {
    dbClient.release();
  }
}

async function processLog(
  log: Log,
  dbClient: pg.PoolClient,
  rpcClient: PublicClient,
  keeperBuf: KeeperSignalBuffer,
) {
  const address = log.address.toLowerCase();

  if (address === env.NOVEL_CORE_ADDRESS.toLowerCase()) {
    await handleNovelCoreEvent(log, dbClient, rpcClient, keeperBuf);
  } else if (env.ROUND_MANAGER_ADDRESS && address === env.ROUND_MANAGER_ADDRESS.toLowerCase()) {
    await handleRoundManagerEvent(log, dbClient, rpcClient, keeperBuf);
  } else if (env.VOTING_ENGINE_ADDRESS && address === env.VOTING_ENGINE_ADDRESS.toLowerCase()) {
    await handleVotingEvent(log, dbClient);
  } else if (env.PRIZE_POOL_ADDRESS && address === env.PRIZE_POOL_ADDRESS.toLowerCase()) {
    await handlePrizePoolEvent(log, dbClient);
  } else if (env.BOUNTY_BOARD_ADDRESS && address === env.BOUNTY_BOARD_ADDRESS.toLowerCase()) {
    await handleBountyBoardEvent(log, dbClient);
  } else if (env.RULES_ENGINE_ADDRESS && address === env.RULES_ENGINE_ADDRESS.toLowerCase()) {
    await handleRulesEvent(log, dbClient, rpcClient);
  } else if (env.USER_REGISTRY_ADDRESS && address === env.USER_REGISTRY_ADDRESS.toLowerCase()) {
    await handleUserRegistryEvent(log, dbClient);
  }
}

export async function startIndexer() {
  ilog.info("Starting indexer");
  let client = createClient();

  const addresses: `0x${string}`[] = [env.NOVEL_CORE_ADDRESS];
  if (env.ROUND_MANAGER_ADDRESS) addresses.push(env.ROUND_MANAGER_ADDRESS);
  if (env.VOTING_ENGINE_ADDRESS) addresses.push(env.VOTING_ENGINE_ADDRESS);
  if (env.PRIZE_POOL_ADDRESS) addresses.push(env.PRIZE_POOL_ADDRESS);
  if (env.BOUNTY_BOARD_ADDRESS) addresses.push(env.BOUNTY_BOARD_ADDRESS);
  if (env.RULES_ENGINE_ADDRESS) addresses.push(env.RULES_ENGINE_ADDRESS);
  if (env.USER_REGISTRY_ADDRESS) addresses.push(env.USER_REGISTRY_ADDRESS);

  // Main loop
  while (true) {
    try {
      let state = await getIndexerState();

      // Reorg check: before pulling new logs, ensure the last committed block still has
      // the same hash on the canonical chain. If not, rewind to a safe depth and replay.
      if (state.lastBlock > 0n && state.lastBlockHash) {
        const verdict = await detectReorg(client, state.lastBlock, state.lastBlockHash);
        if (verdict === "reorg") {
          const rewindDepth = BigInt(env.INDEXER_CONFIRMATION_BLOCKS);
          const safeBlock = state.lastBlock > rewindDepth ? state.lastBlock - rewindDepth : 0n;
          const dbClient = await getClient();
          try {
            await dbClient.query("BEGIN");
            await rollbackToBlock(dbClient, safeBlock);
            await dbClient.query("COMMIT");
          } catch (err) {
            await dbClient.query("ROLLBACK").catch(() => {});
            throw err;
          } finally {
            dbClient.release();
          }
          state = await getIndexerState();
        }
      }

      const fromBlock = state.lastBlock > 0n ? state.lastBlock + 1n : env.INDEXER_START_BLOCK;
      const latestBlock = await client.getBlockNumber();
      const chainHead = latestBlock - BigInt(env.INDEXER_CONFIRMATION_BLOCKS);

      if (chainHead < 0n || fromBlock > chainHead) {
        // Caught up — poll
        await sleep(env.INDEXER_POLL_INTERVAL_MS);
        continue;
      }

      const lag = chainHead - fromBlock;
      if (lag > 100n) {
        ilog.info(
          { fromBlock: fromBlock.toString(), chainHead: chainHead.toString(), lag: lag.toString() },
          "Indexer catching up",
        );
      }

      const result = await fetchBatchWithRetry(
        client,
        fromBlock,
        state.batchSize,
        chainHead,
        addresses,
      );
      // Update client in case RPC was rotated during retry
      client = result.client;

      if (result.logs.length > 0) {
        ilog.info(
          {
            count: result.logs.length,
            fromBlock: fromBlock.toString(),
            toBlock: result.endBlock.toString(),
          },
          "Processing logs",
        );
        const batchStart = Date.now();
        await processBatch(result.logs, result.endBlock, result.endBlockHash, client);
        ilog.info(
          {
            ms: Date.now() - batchStart,
            fromBlock: fromBlock.toString(),
            toBlock: result.endBlock.toString(),
          },
          "Batch committed",
        );
      } else {
        await processBatch(result.logs, result.endBlock, result.endBlockHash, client);
      }

      // If we're caught up, slow down
      if (result.endBlock >= chainHead) {
        await sleep(env.INDEXER_POLL_INTERVAL_MS);
      }
    } catch (err) {
      ilog.error({ err }, "Indexer error");
      await sleep(5000);
      // Recreate client in case of connection issues
      client = createClient();
    }
  }
}

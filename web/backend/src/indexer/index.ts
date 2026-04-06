import { createPublicClient, http, type Log, type PublicClient, formatEther } from "viem";
import { foundry } from "viem/chains";
import { getClient, query } from "../db/index.js";
import { env } from "../utils/env.js";
import { novelCoreAbi, votingEngineAbi, prizePoolAbi, chapterNFTAbi } from "../utils/abi.js";
import { handleNovelCoreEvent, handleVotingEvent, handlePrizePoolEvent, handleNFTEvent, handleRulesEvent } from "./handlers.js";
import { fetchChapterContent } from "./content-fetcher.js";

let currentRpcIndex = 0;
const allRpcUrls = [env.RPC_URL, ...env.RPC_FALLBACK_URLS];

function getTransport() {
  return http(allRpcUrls[currentRpcIndex]);
}

function rotateRpc() {
  currentRpcIndex = (currentRpcIndex + 1) % allRpcUrls.length;
  console.log(`Rotated to RPC #${currentRpcIndex}: ${allRpcUrls[currentRpcIndex]}`);
}

function createClient(): PublicClient {
  return createPublicClient({ chain: foundry, transport: getTransport() }) as PublicClient;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getIndexerState(): Promise<{ lastBlock: bigint; lastBlockHash: string | null; batchSize: number }> {
  const res = await query("SELECT last_block, last_block_hash, batch_size FROM indexer_state WHERE id = 1");
  const row = res.rows[0];
  return {
    lastBlock: BigInt(row.last_block),
    lastBlockHash: row.last_block_hash,
    batchSize: row.batch_size,
  };
}

async function updateIndexerState(block: bigint, blockHash: string | null) {
  await query("UPDATE indexer_state SET last_block = $1, last_block_hash = $2, updated_at = NOW() WHERE id = 1", [
    block.toString(),
    blockHash,
  ]);
}

async function adjustBatchSize(newSize: number) {
  await query("UPDATE indexer_state SET batch_size = $1 WHERE id = 1", [newSize]);
}

interface FetchResult {
  logs: Log[];
  endBlock: bigint;
  endBlockHash: string | null;
}

async function fetchLogs(
  client: PublicClient,
  fromBlock: bigint,
  toBlock: bigint,
  addresses: `0x${string}`[]
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
  addresses: `0x${string}`[]
): Promise<FetchResult> {
  let currentBatchSize = batchSize;
  let retries = 0;
  const maxRetries = 10;

  while (retries < maxRetries) {
    const toBlock = fromBlock + BigInt(currentBatchSize) - 1n > chainHead
      ? chainHead
      : fromBlock + BigInt(currentBatchSize) - 1n;

    try {
      const logs = await fetchLogs(client, fromBlock, toBlock, addresses);
      const block = await client.getBlock({ blockNumber: toBlock });

      // Restore batch size if we had shrunk it
      if (currentBatchSize < batchSize) {
        await adjustBatchSize(currentBatchSize);
      }

      return { logs, endBlock: toBlock, endBlockHash: block.hash };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      retries++;

      if (msg.includes("429") || msg.includes("rate limit")) {
        const delay = Math.min(1000 * Math.pow(2, retries), 60000);
        console.warn(`Rate limited, waiting ${delay}ms (retry ${retries}/${maxRetries})`);
        await sleep(delay);
      } else if (msg.includes("range") || msg.includes("block range") || msg.includes("too many")) {
        currentBatchSize = Math.max(10, Math.floor(currentBatchSize / 2));
        console.warn(`Range too wide, reducing batch to ${currentBatchSize}`);
      } else if (msg.includes("timeout") || msg.includes("ECONNREFUSED") || msg.includes("network")) {
        const delay = Math.min(1000 * Math.pow(2, retries), 60000);
        console.warn(`Network error, waiting ${delay}ms (retry ${retries}/${maxRetries})`);
        if (allRpcUrls.length > 1) rotateRpc();
        await sleep(delay);
        client = createClient();
      } else {
        console.error(`Unexpected error fetching logs: ${msg}`);
        const delay = Math.min(1000 * Math.pow(2, retries), 60000);
        await sleep(delay);
      }
    }
  }

  throw new Error(`Failed to fetch logs after ${maxRetries} retries from block ${fromBlock}`);
}

async function processBatch(logs: Log[], endBlock: bigint, endBlockHash: string | null, client: PublicClient) {
  const dbClient = await getClient();
  try {
    await dbClient.query("BEGIN");

    for (const log of logs) {
      try {
        await processLog(log, dbClient, client);
      } catch (err) {
        // Log and skip individual event failures to avoid rolling back the entire batch
        const topic0 = log.topics[0]?.slice(0, 10) ?? "unknown";
        console.error(`[indexer] Event processing failed (topic=${topic0} block=${log.blockNumber} tx=${log.transactionHash}):`, err instanceof Error ? err.message : err);
      }
    }

    await dbClient.query(
      "UPDATE indexer_state SET last_block = $1, last_block_hash = $2, updated_at = NOW() WHERE id = 1",
      [endBlock.toString(), endBlockHash]
    );

    await dbClient.query("COMMIT");
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function processLog(log: Log, dbClient: pg.PoolClient, rpcClient: PublicClient) {
  const address = log.address.toLowerCase();

  if (address === env.NOVEL_CORE_ADDRESS.toLowerCase()) {
    await handleNovelCoreEvent(log, dbClient, rpcClient);
  } else if (env.VOTING_ENGINE_ADDRESS && address === env.VOTING_ENGINE_ADDRESS.toLowerCase()) {
    await handleVotingEvent(log, dbClient);
  } else if (env.PRIZE_POOL_ADDRESS && address === env.PRIZE_POOL_ADDRESS.toLowerCase()) {
    await handlePrizePoolEvent(log, dbClient);
  } else if (env.CHAPTER_NFT_ADDRESS && address === env.CHAPTER_NFT_ADDRESS.toLowerCase()) {
    await handleNFTEvent(log, dbClient);
  } else if (env.RULES_ENGINE_ADDRESS && address === env.RULES_ENGINE_ADDRESS.toLowerCase()) {
    await handleRulesEvent(log, dbClient, rpcClient);
  }
}

import type pg from "pg";

export async function startIndexer() {
  console.log("Starting indexer...");
  let client = createClient();

  const addresses: `0x${string}`[] = [env.NOVEL_CORE_ADDRESS];
  if (env.VOTING_ENGINE_ADDRESS) addresses.push(env.VOTING_ENGINE_ADDRESS);
  if (env.PRIZE_POOL_ADDRESS) addresses.push(env.PRIZE_POOL_ADDRESS);
  if (env.CHAPTER_NFT_ADDRESS) addresses.push(env.CHAPTER_NFT_ADDRESS);
  if (env.RULES_ENGINE_ADDRESS) addresses.push(env.RULES_ENGINE_ADDRESS);

  // Main loop
  while (true) {
    try {
      const state = await getIndexerState();
      const fromBlock = state.lastBlock > 0n ? state.lastBlock + 1n : env.INDEXER_START_BLOCK;
      const chainHead = await client.getBlockNumber();

      if (fromBlock > chainHead) {
        // Caught up — poll
        await sleep(env.INDEXER_POLL_INTERVAL_MS);
        continue;
      }

      const lag = chainHead - fromBlock;
      if (lag > 100n) {
        console.log(`Indexer catching up: block ${fromBlock} → ${chainHead} (${lag} blocks behind)`);
      }

      const { logs, endBlock, endBlockHash } = await fetchBatchWithRetry(
        client,
        fromBlock,
        state.batchSize,
        chainHead,
        addresses
      );

      if (logs.length > 0) {
        console.log(`[indexer] Processing ${logs.length} logs from block ${fromBlock} to ${endBlock}`);
        const batchStart = Date.now();
        await processBatch(logs, endBlock, endBlockHash, client);
        console.log(`[indexer] Batch committed in ${Date.now() - batchStart}ms (blocks ${fromBlock}–${endBlock})`);
      } else {
        await processBatch(logs, endBlock, endBlockHash, client);
      }

      // If we're caught up, slow down
      if (endBlock >= chainHead) {
        await sleep(env.INDEXER_POLL_INTERVAL_MS);
      }
    } catch (err) {
      console.error("[indexer] Error:", err instanceof Error ? err.stack || err.message : err);
      await sleep(5000);
      // Recreate client in case of connection issues
      client = createClient();
    }
  }
}

import { parseAbi, type PublicClient, type WalletClient } from "viem";

import { query } from "../db/index.js";
import { env } from "../utils/env.js";
import { createLogger } from "../utils/logger.js";
import { Mutex } from "../utils/mutex.js";
import { createKeeperClients } from "../utils/viem-client.js";
import { KeeperQueue } from "./queue.js";
import { batchReveal } from "./reveal.js";

const log = createLogger("keeper");

// Keeper needs phase transition functions plus chain reads for leaf computation.
const keeperAbi = parseAbi([
  "function startRound(uint64 novelId, uint64[] leaves) external",
  "function closeNomination(uint64 novelId) external",
  "function closeCommit(uint64 novelId) external",
  "function settleRound(uint64 novelId) external",
]);

// Phase enum matching the contract
const Phase = { Idle: 0, Nominating: 1, Committing: 2, Revealing: 3 } as const;

interface NovelState {
  id: bigint;
  currentRound: number;
  roundPhase: number;
  phaseStartTime: bigint;
  lastSettleTime: bigint;
  config: {
    nominateDuration: bigint;
    commitDuration: bigint;
    revealDuration: bigint;
    minRoundGap: bigint;
  };
}

let publicClient: PublicClient;
let walletClient: WalletClient;
let keeperAddress: `0x${string}`;

/**
 * Serializes all `walletClient.writeContract` calls so that viem's automatic
 * nonce fetch (`eth_getTransactionCount(pending)`) cannot return the same nonce
 * to two concurrent workers. Simulate calls remain parallel.
 */
const writeMutex = new Mutex();

export async function keeperWrite(
  request: Parameters<WalletClient["writeContract"]>[0],
): Promise<`0x${string}`> {
  return writeMutex.runExclusive(() => walletClient.writeContract(request) as Promise<`0x${string}`>);
}

export function getKeeperClients() {
  return { publicClient, walletClient, keeperAddress };
}

function rowToNovelState(r: any): NovelState {
  return {
    id: BigInt(r.id),
    currentRound: r.current_round,
    roundPhase: r.round_phase,
    phaseStartTime: BigInt(r.phase_start_time),
    lastSettleTime: BigInt(r.last_settle_time),
    config: {
      nominateDuration: BigInt(r.config.nominateDuration || "0"),
      commitDuration: BigInt(r.config.commitDuration || "0"),
      revealDuration: BigInt(r.config.revealDuration || "0"),
      minRoundGap: BigInt(r.config.minRoundGap || "0"),
    },
  };
}

async function getActiveNovelIds(): Promise<bigint[]> {
  const { rows } = await query("SELECT id FROM novels WHERE active = TRUE");
  return rows.map((r: any) => BigInt(r.id));
}

async function getNovelState(novelId: bigint): Promise<NovelState | null> {
  const { rows } = await query(
    "SELECT id, current_round, round_phase, phase_start_time, last_settle_time, config FROM novels WHERE id = $1 AND active = TRUE",
    [novelId.toString()],
  );
  if (rows.length === 0) return null;
  return rowToNovelState(rows[0]);
}

async function sendKeeperTx(
  functionName: string,
  novelId: bigint,
  extraArgs: unknown[] = [],
): Promise<boolean> {
  try {
    const target = env.ROUND_MANAGER_ADDRESS;
    if (!target) {
      log.warn({ functionName, novelId }, "ROUND_MANAGER_ADDRESS not configured; skipping");
      return false;
    }
    const { request } = await publicClient.simulateContract({
      address: target,
      abi: keeperAbi,
      functionName: functionName as any,
      args: [novelId, ...extraArgs] as any,
      account: keeperAddress,
    });
    const hash = await keeperWrite(request as any);
    log.info({ functionName, novelId, hash }, "keeper tx sent");
    return true;
  } catch (err: any) {
    const short = err?.shortMessage ?? "";
    if (typeof short === "string" && short.toLowerCase().includes("revert")) {
      return false;
    }
    log.error(
      { functionName, novelId, name: err?.name ?? "Error", code: err?.code ?? "", err },
      "keeper tx failed",
    );
    return false;
  }
}

/**
 * Compute leaves for `startRound` from the indexed DB state.
 * For each current world-line ancestor, find the deepest descendant with no children.
 * A single SQL query scales to millions of chapters without extra RPC calls.
 */
async function buildStartRoundLeaves(novelId: bigint): Promise<bigint[]> {
  // Ancestors (current world line heads) live in `chapters.is_world_line = TRUE`.
  const ancestorsRes = await query(
    `SELECT id FROM chapters WHERE novel_id = $1 AND is_world_line = TRUE ORDER BY id ASC`,
    [novelId.toString()],
  );
  if (ancestorsRes.rows.length === 0) return [];

  const leaves: bigint[] = [];
  for (const { id: ancestorId } of ancestorsRes.rows) {
    // Walk descendants via a recursive CTE, pick the max-depth chapter under this ancestor
    // that itself is a leaf (has no children of its own within the same novel).
    const leafRes = await query(
      `WITH RECURSIVE descendants AS (
         SELECT id, parent_id, depth FROM chapters WHERE id = $1 AND novel_id = $2
         UNION ALL
         SELECT c.id, c.parent_id, c.depth FROM chapters c
         INNER JOIN descendants d ON c.parent_id = d.id
         WHERE c.novel_id = $2
       )
       SELECT d.id
       FROM descendants d
       WHERE NOT EXISTS (
         SELECT 1 FROM chapters cc WHERE cc.parent_id = d.id AND cc.novel_id = $2
       )
       ORDER BY d.depth DESC, d.id ASC
       LIMIT 1`,
      [ancestorId, novelId.toString()],
    );
    if (leafRes.rows.length === 0) {
      // Ancestor itself must be the leaf (shouldn't happen — it's present in `descendants`),
      // but fall back gracefully.
      leaves.push(BigInt(ancestorId));
    } else {
      leaves.push(BigInt(leafRes.rows[0].id));
    }
  }
  return leaves;
}

/** Check a single novel's state and take action if a phase transition is due. */
async function checkNovel(novelId: bigint): Promise<void> {
  const state = await getNovelState(novelId);
  if (!state) return; // novel not found or inactive

  const { id, currentRound, roundPhase, phaseStartTime, lastSettleTime, config } = state;
  const now = BigInt(Math.floor(Date.now() / 1000));

  switch (roundPhase) {
    case Phase.Idle:
      // Try startRound whenever enqueued. simulateContract handles timing / leaves errors.
      if (lastSettleTime + config.minRoundGap <= now) {
        try {
          const leaves = await buildStartRoundLeaves(id);
          if (leaves.length === 0) return; // no world line → nothing to start
          await sendKeeperTx("startRound", id, [leaves]);
        } catch (err) {
          log.error({ err, novelId: id }, "startRound prep error");
        }
      }
      break;

    case Phase.Nominating:
      if (phaseStartTime + config.nominateDuration <= now) {
        await sendKeeperTx("closeNomination", id);
      }
      break;

    case Phase.Committing:
      if (phaseStartTime + config.commitDuration <= now) {
        await sendKeeperTx("closeCommit", id);
      }
      break;

    case Phase.Revealing:
      // First, batch-reveal any pending votes the user delegated to us.
      if (env.VOTE_ENCRYPTION_KEY) {
        try {
          const result = await batchReveal(id, currentRound, publicClient, keeperAddress);
          if (result.revealed > 0 || result.failed > 0) {
            log.info(
              {
                novelId: id,
                round: currentRound,
                revealed: result.revealed,
                failed: result.failed,
              },
              "batchReveal summary",
            );
          }
        } catch (err) {
          log.error({ err, novelId: id }, "batchReveal error");
        }
      }
      if (phaseStartTime + config.revealDuration <= now) {
        await sendKeeperTx("settleRound", id);
      }
      break;
  }

  // Note: completeNovel is NOT auto-triggered by the keeper daemon.
  // It is a lifecycle-end action that must be initiated by the novel creator,
  // the contract owner, or any caller after INACTIVITY_TIMEOUT (30 days) has elapsed.
  // The keeper's responsibility is limited to round-phase advancement. If/when a
  // product decision to auto-complete is made, add a Phase.Idle branch here that
  // checks `now >= max(phaseStartTime, latestAncestorTimestamp) + INACTIVITY_TIMEOUT`.
}

// Global queue instance (exported so indexer can enqueue on events)
let keeperQueue: KeeperQueue | null = null;

/**
 * Pending signals buffered during the current indexer DB transaction.
 * Indexer handlers call `signalKeeper` to populate; indexer calls `flushKeeperSignals`
 * after COMMIT so the worker sees the up-to-date DB state when it reads.
 */
export class KeeperSignalBuffer {
  private ids = new Set<string>();
  add(novelId: bigint): void {
    this.ids.add(novelId.toString());
  }
  flush(): void {
    if (!keeperQueue) return;
    for (const id of this.ids) keeperQueue.enqueue(BigInt(id));
    this.ids.clear();
  }
}

/**
 * Called by indexer handlers after processing a relevant event.
 * If a buffer is provided (normal path), signals are deferred until COMMIT.
 * If buffer is null (direct signal), enqueues immediately.
 * No-op if keeper is disabled.
 */
export function signalKeeper(novelId: bigint, buffer: KeeperSignalBuffer | null = null): void {
  if (buffer) buffer.add(novelId);
  else keeperQueue?.enqueue(novelId);
}

export function startKeeper() {
  if (!env.KEEPER_PRIVATE_KEY) {
    log.info("No KEEPER_PRIVATE_KEY configured, skipping");
    return;
  }

  const clients = createKeeperClients();
  publicClient = clients.publicClient;
  walletClient = clients.walletClient;
  keeperAddress = clients.account.address;

  const maskedAddr = `${keeperAddress.slice(0, 6)}...`;
  log.info(
    { address: maskedAddr, pollMs: env.KEEPER_POLL_INTERVAL_MS, concurrency: 5 },
    "Keeper started",
  );

  keeperQueue = new KeeperQueue(checkNovel, 5);
  keeperQueue.start();

  // Periodic safety-net poll: enqueue all active novels. Handles time-based transitions
  // (phase deadline reached but no event was emitted to trigger a check).
  const enqueueAllActive = async () => {
    try {
      const ids = await getActiveNovelIds();
      for (const id of ids) keeperQueue!.enqueue(id);
    } catch (err) {
      log.error({ err }, "poll error");
    }
  };

  // Initial run after a short delay (let indexer catch up first)
  setTimeout(enqueueAllActive, 5000);
  setInterval(enqueueAllActive, env.KEEPER_POLL_INTERVAL_MS);
}

import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { parseAbi } from "viem";
import { env } from "../utils/env.js";
import { query } from "../db/index.js";
import { batchReveal } from "./reveal.js";
import { KeeperQueue } from "./queue.js";

// Keeper needs phase transition functions plus chain reads for path computation
const keeperAbi = parseAbi([
  "function startRound(uint64 novelId, uint64[] leaves) external",
  "function closeNomination(uint64 novelId) external",
  "function closeCommit(uint64 novelId) external",
  "function settleRound(uint64 novelId, uint64[][] winnerPaths) external",
]);

const novelCoreReadAbi = parseAbi([
  "function getWorldLineAncestors(uint64 novelId) external view returns (uint64[])",
  "function getChapter(uint64 chapterId) external view returns ((uint64 id, uint64 novelId, uint64 parentId, address author, bytes32 contentHash, uint64 declaredLength, uint32 depth, uint64 timestamp, uint64[] children))",
]);

const votingEngineReadAbi = parseAbi([
  "function tallyVotes(uint64 novelId, uint32 round, uint32 winnerCount) external returns (uint64[])",
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

function initClients() {
  const chain: Chain = foundry;
  const transport = http(env.RPC_URL);
  publicClient = createPublicClient({ chain, transport });
  const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY);
  keeperAddress = account.address;
  walletClient = createWalletClient({ chain, transport, account });
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
    [novelId.toString()]
  );
  if (rows.length === 0) return null;
  return rowToNovelState(rows[0]);
}

async function sendKeeperTxWithArgs(
  functionName: string,
  novelId: bigint,
  extraArgs: unknown[],
): Promise<boolean> {
  try {
    const target = env.ROUND_MANAGER_ADDRESS;
    if (!target) {
      console.warn(`[Keeper] ROUND_MANAGER_ADDRESS not configured; skipping ${functionName}(${novelId})`);
      return false;
    }
    const { request } = await publicClient.simulateContract({
      address: target,
      abi: keeperAbi,
      functionName: functionName as any,
      args: [novelId, ...extraArgs] as any,
      account: keeperAddress,
    });
    const hash = await walletClient.writeContract(request as any);
    console.log(`[Keeper] ${functionName}(${novelId}) tx: ${hash}`);
    return true;
  } catch (err: any) {
    const msg = err?.shortMessage || err?.message || String(err);
    if (msg.includes("revert")) {
      return false;
    }
    console.error(`[Keeper] ${functionName}(${novelId}) error: ${msg}`);
    return false;
  }
}

async function sendKeeperTx(functionName: string, novelId: bigint): Promise<boolean> {
  return sendKeeperTxWithArgs(functionName, novelId, []);
}

/** Walk parent chain from `from` upward, return [from, ..., anchor] or null if no anchor reached. */
async function buildPathToAnchor(
  novelId: bigint,
  from: bigint,
  anchors: readonly bigint[],
): Promise<bigint[] | null> {
  void novelId;
  const path: bigint[] = [];
  let cur = from;
  while (cur !== 0n) {
    path.push(cur);
    if (anchors.includes(cur)) return path;
    const ch = (await publicClient.readContract({
      address: env.NOVEL_CORE_ADDRESS,
      abi: novelCoreReadAbi,
      functionName: "getChapter",
      args: [cur],
    })) as { parentId: bigint; depth: number };
    if (ch.depth <= 1) break;
    cur = ch.parentId;
  }
  return null;
}

/** Find the deepest leaf descendant of a given chapter via greedy first-child walk. */
async function deepestLeafUnder(chapterId: bigint): Promise<bigint> {
  let cur = chapterId;
  while (true) {
    const ch = (await publicClient.readContract({
      address: env.NOVEL_CORE_ADDRESS,
      abi: novelCoreReadAbi,
      functionName: "getChapter",
      args: [cur],
    })) as { children: readonly bigint[] };
    if (ch.children.length === 0) return cur;
    // Greedy: walk into the deepest child by recursive deepestLeafUnder; keep simple by picking
    // the child that yields the deepest subtree. For a first cut, just first child.
    cur = ch.children[0];
  }
}

/** Build leaves array for startRound: one deepest leaf per current worldLineAncestor. */
async function buildStartRoundLeaves(novelId: bigint): Promise<bigint[]> {
  const ancestors = (await publicClient.readContract({
    address: env.NOVEL_CORE_ADDRESS,
    abi: novelCoreReadAbi,
    functionName: "getWorldLineAncestors",
    args: [novelId],
  })) as readonly bigint[];
  const leaves: bigint[] = [];
  for (const a of ancestors) leaves.push(await deepestLeafUnder(a));
  return leaves;
}

/** Build winnerPaths for settleRound: simulate tallyVotes then walk each winner up to a prev ancestor. */
async function buildSettleWinnerPaths(novelId: bigint, currentRound: number): Promise<bigint[][]> {
  // Read current worldLineAncestors (these are the "prev" set for this settlement)
  const prevAncestors = (await publicClient.readContract({
    address: env.NOVEL_CORE_ADDRESS,
    abi: novelCoreReadAbi,
    functionName: "getWorldLineAncestors",
    args: [novelId],
  })) as readonly bigint[];

  // Read worldLineCount from novel config
  const novel = await getNovelState(novelId);
  if (!novel) return [];
  const N = Number((novel as any).config?.worldLineCount ?? 2); // fallback

  // Simulate tallyVotes: it's onlyRoundManager but we override `from`
  const simulation = await publicClient.simulateContract({
    address: env.VOTING_ENGINE_ADDRESS,
    abi: votingEngineReadAbi,
    functionName: "tallyVotes",
    args: [novelId, currentRound, N],
    account: env.ROUND_MANAGER_ADDRESS,
  });
  const winners = simulation.result as readonly bigint[];

  const winnerPaths: bigint[][] = [];
  for (const w of winners) {
    const path = await buildPathToAnchor(novelId, w, prevAncestors);
    winnerPaths.push(path ?? []);
  }
  return winnerPaths;
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
          await sendKeeperTxWithArgs("startRound", id, [leaves]);
        } catch (err) {
          console.error(`[Keeper] startRound prep error for novel=${id}: ${err}`);
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
          const result = await batchReveal(id, currentRound, publicClient, walletClient, keeperAddress);
          if (result.revealed > 0 || result.failed > 0) {
            console.log(`[Keeper] batchReveal novel=${id} round=${currentRound} revealed=${result.revealed} failed=${result.failed}`);
          }
        } catch (err) {
          console.error(`[Keeper] batchReveal error for novel=${id}: ${err}`);
        }
      }
      if (phaseStartTime + config.revealDuration <= now) {
        try {
          const winnerPaths = await buildSettleWinnerPaths(id, currentRound);
          await sendKeeperTxWithArgs("settleRound", id, [winnerPaths]);
        } catch (err) {
          console.error(`[Keeper] settleRound prep error for novel=${id}: ${err}`);
        }
      }
      break;
  }
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
    console.log("[Keeper] No KEEPER_PRIVATE_KEY configured, skipping");
    return;
  }

  initClients();
  console.log(`[Keeper] Started (address: ${keeperAddress}, poll: ${env.KEEPER_POLL_INTERVAL_MS}ms, concurrency: 5)`);

  keeperQueue = new KeeperQueue(checkNovel, 5);
  keeperQueue.start();

  // Periodic safety-net poll: enqueue all active novels. Handles time-based transitions
  // (phase deadline reached but no event was emitted to trigger a check).
  const enqueueAllActive = async () => {
    try {
      const ids = await getActiveNovelIds();
      for (const id of ids) keeperQueue!.enqueue(id);
    } catch (err) {
      console.error("[Keeper] poll error:", err);
    }
  };

  // Initial run after a short delay (let indexer catch up first)
  setTimeout(enqueueAllActive, 5000);
  setInterval(enqueueAllActive, env.KEEPER_POLL_INTERVAL_MS);
}

import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { parseAbi } from "viem";
import { env } from "../utils/env.js";
import { query } from "../db/index.js";
import { batchReveal } from "./reveal.js";

// Keeper only needs the phase transition functions
const keeperAbi = parseAbi([
  "function startRound(uint64 novelId) external",
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

function initClients() {
  const chain: Chain = foundry;
  const transport = http(env.RPC_URL);
  publicClient = createPublicClient({ chain, transport });
  const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY);
  keeperAddress = account.address;
  walletClient = createWalletClient({ chain, transport, account });
}

async function getActiveNovels(): Promise<NovelState[]> {
  const { rows } = await query(
    "SELECT id, current_round, round_phase, phase_start_time, last_settle_time, config FROM novels WHERE active = TRUE"
  );
  return rows.map((r: any) => ({
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
  }));
}

async function sendKeeperTx(functionName: string, novelId: bigint): Promise<boolean> {
  try {
    const { request } = await publicClient.simulateContract({
      address: env.NOVEL_CORE_ADDRESS,
      abi: keeperAbi,
      functionName: functionName as any,
      args: [novelId],
      account: keeperAddress,
    });
    const hash = await walletClient.writeContract(request as any);
    console.log(`[Keeper] ${functionName}(${novelId}) tx: ${hash}`);
    return true;
  } catch (err: any) {
    // Expected: another keeper already executed, or conditions not met
    const msg = err?.shortMessage || err?.message || String(err);
    if (msg.includes("revert")) {
      // Silent skip — normal when another keeper already called or timing not met
      return false;
    }
    console.error(`[Keeper] ${functionName}(${novelId}) error: ${msg}`);
    return false;
  }
}

async function keeperCycle() {
  const novels = await getActiveNovels();
  const now = BigInt(Math.floor(Date.now() / 1000));

  for (const novel of novels) {
    const { id, currentRound, roundPhase, phaseStartTime, lastSettleTime, config } = novel;

    switch (roundPhase) {
      case Phase.Idle:
        if (lastSettleTime + config.minRoundGap <= now) {
          await sendKeeperTx("startRound", id);
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
        // This must happen before settleRound so the votes count.
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
          await sendKeeperTx("settleRound", id);
        }
        break;
    }
  }
}

export function startKeeper() {
  if (!env.KEEPER_PRIVATE_KEY) {
    console.log("[Keeper] No KEEPER_PRIVATE_KEY configured, skipping");
    return;
  }

  initClients();
  console.log(`[Keeper] Started (address: ${keeperAddress}, interval: ${env.KEEPER_POLL_INTERVAL_MS}ms)`);

  const run = async () => {
    try {
      await keeperCycle();
    } catch (err) {
      console.error("[Keeper] Cycle error:", err);
    }
  };

  // Initial run after a short delay (let indexer catch up first)
  setTimeout(run, 5000);
  setInterval(run, env.KEEPER_POLL_INTERVAL_MS);
}

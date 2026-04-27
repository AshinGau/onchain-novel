// Walk NovelCore's on-chain address book to discover the rest of the
// deployment. The single trust root is `novelCore`; every other contract is
// either reachable from it (votingEngine / prizePool / rulesEngine /
// roundManager / userRegistry are direct getters) or one hop further
// (bountyBoard hangs off PrizePool). Replaces the 7-field config block with
// a single address.
import { createPublicClient, http, type Address, type PublicClient } from "viem";

import { novelCoreAbi, prizePoolAbi } from "./abi.js";

export interface ResolvedContracts {
  novelCore: Address;
  votingEngine: Address;
  prizePool: Address;
  rulesEngine: Address;
  roundManager: Address;
  userRegistry: Address;
  bountyBoard: Address;
}

export interface ResolveContractsOptions {
  novelCore: Address;
  /** Caller-supplied client (preferred — reuses existing connection). */
  client?: PublicClient;
  /** Used only when `client` isn't supplied; we build a transient one. */
  rpcUrl?: string;
}

/**
 * Resolve the full Contracts struct from a single root address. Issues 5
 * parallel reads against NovelCore + 1 dependent read against PrizePool —
 * one round-trip's worth of latency on a sane RPC. Caller is responsible for
 * caching the result (these addresses change only on redeploy / setter call).
 */
export async function resolveContracts(opts: ResolveContractsOptions): Promise<ResolvedContracts> {
  const client =
    opts.client ??
    (() => {
      if (!opts.rpcUrl) throw new Error("resolveContracts: must supply either client or rpcUrl");
      return createPublicClient({ transport: http(opts.rpcUrl) });
    })();

  const [votingEngine, prizePool, rulesEngine, roundManager, userRegistry] = await Promise.all([
    client.readContract({ address: opts.novelCore, abi: novelCoreAbi, functionName: "votingEngine" }),
    client.readContract({ address: opts.novelCore, abi: novelCoreAbi, functionName: "prizePool" }),
    client.readContract({ address: opts.novelCore, abi: novelCoreAbi, functionName: "rulesEngine" }),
    client.readContract({ address: opts.novelCore, abi: novelCoreAbi, functionName: "roundManager" }),
    client.readContract({ address: opts.novelCore, abi: novelCoreAbi, functionName: "userRegistry" }),
  ]);

  // bountyBoard hangs off PrizePool, not NovelCore — fetch it after we know
  // PrizePool's address. Sequential by necessity.
  const bountyBoard = await client.readContract({
    address: prizePool as Address,
    abi: prizePoolAbi,
    functionName: "bountyBoard",
  });

  return {
    novelCore: opts.novelCore,
    votingEngine: votingEngine as Address,
    prizePool: prizePool as Address,
    rulesEngine: rulesEngine as Address,
    roundManager: roundManager as Address,
    userRegistry: userRegistry as Address,
    bountyBoard: bountyBoard as Address,
  };
}

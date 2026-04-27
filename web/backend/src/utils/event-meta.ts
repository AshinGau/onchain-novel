import { decodeEventLog, type Abi, type Log } from "viem";

/** Decode an event log safely. Returns null if ABI doesn't match (anonymous / unknown event). */
export function safeDecode(
  abi: Abi,
  log: Log,
): { eventName: string; args: Record<string, unknown> } | null {
  try {
    const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
    return decoded as unknown as { eventName: string; args: Record<string, unknown> };
  } catch {
    return null;
  }
}

export interface EventMeta {
  blockNumber: string;
  txHash: string | null;
  logIndex: number | null;
}

export function eventMeta(log: Log): EventMeta {
  // Indexer only fetches logs from confirmed blocks, so blockNumber is never
  // null here. Throw if the invariant breaks rather than papering over with 0.
  if (log.blockNumber === null) {
    throw new Error("eventMeta: log.blockNumber is null (unconfirmed block?)");
  }
  return {
    blockNumber: log.blockNumber.toString(),
    txHash: log.transactionHash,
    logIndex: log.logIndex,
  };
}

/** Lowercase an address-like field, with a runtime guard. */
export function addrLc(x: unknown): string {
  if (typeof x !== "string") return "";
  return x.toLowerCase();
}

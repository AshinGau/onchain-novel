/**
 * localStorage-based vote salt storage.
 *
 * Key format: `vote:${novelId}:${round}`
 * Value: JSON `{ candidateId: string, salt: string }`
 */

import { keccak256, encodePacked, toHex } from "viem";

const PREFIX = "vote";

function storageKey(novelId: string, round: number): string {
  return `${PREFIX}:${novelId}:${round}`;
}

export interface StoredVote {
  candidateId: string;
  salt: string;
}

/** Save vote data after successful commit */
export function saveVote(
  novelId: string,
  round: number,
  candidateId: string,
  salt: string
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    storageKey(novelId, round),
    JSON.stringify({ candidateId, salt })
  );
}

/** Load saved vote data for reveal */
export function loadVote(
  novelId: string,
  round: number
): StoredVote | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(storageKey(novelId, round));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredVote;
  } catch {
    return null;
  }
}

/** Remove vote data after successful reveal */
export function clearVote(novelId: string, round: number): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(storageKey(novelId, round));
}

/**
 * Convert user-provided salt string to bytes32.
 * Used identically at commit and reveal time so the hash matches.
 */
export function toBytes32Salt(userInput: string): `0x${string}` {
  return keccak256(toHex(userInput));
}

/**
 * Compute commitHash = keccak256(abi.encodePacked(uint64(candidateId), bytes32(salt)))
 */
export function computeCommitHash(
  candidateId: bigint,
  salt: `0x${string}`
): `0x${string}` {
  return keccak256(encodePacked(["uint64", "bytes32"], [candidateId, salt]));
}

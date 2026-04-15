/**
 * localStorage-based vote salt storage.
 *
 * Salts are generated automatically by the wallet (32 random bytes) and
 * persisted as 0x-prefixed hex so the user never has to remember a string.
 *
 * Key format: `vote:${novelId}:${round}`
 * Value:      JSON `{ candidateId: string, salt: 0x...64hex, keeperSubmitted: bool }`
 */

import { encodePacked, keccak256, toHex } from "viem";

const PREFIX = "vote";

function storageKey(novelId: string, round: number): string {
  return `${PREFIX}:${novelId}:${round}`;
}

export interface StoredVote {
  candidateId: string;
  salt: `0x${string}`;
  /** True if the plaintext was successfully submitted to the keeper-assisted reveal endpoint. */
  keeperSubmitted: boolean;
}

export function saveVote(
  novelId: string,
  round: number,
  candidateId: string,
  salt: `0x${string}`,
  keeperSubmitted: boolean,
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    storageKey(novelId, round),
    JSON.stringify({ candidateId, salt, keeperSubmitted } satisfies StoredVote),
  );
}

export function loadVote(novelId: string, round: number): StoredVote | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(storageKey(novelId, round));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredVote;
  } catch {
    return null;
  }
}

export function clearVote(novelId: string, round: number): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(storageKey(novelId, round));
}

/**
 * Generate a fresh 32-byte random salt as 0x-prefixed hex.
 * Uses crypto.getRandomValues which is available in browser + Node 19+.
 */
export function generateSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/**
 * Compute commitHash = keccak256(abi.encodePacked(address(voter), uint64(candidateId), bytes32(salt))).
 * Voter binding blocks commit-copy attacks (Bob copies Alice's hash and reveals after she does).
 */
export function computeCommitHash(
  voter: `0x${string}`,
  candidateId: bigint,
  salt: `0x${string}`,
): `0x${string}` {
  return keccak256(encodePacked(["address", "uint64", "bytes32"], [voter, candidateId, salt]));
}

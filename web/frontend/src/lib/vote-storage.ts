/** Shared localStorage helpers for commit-reveal vote data.
 *  Supports multiple votes per round (one per candidate).
 *  Stores the user-facing salt (original input), not bytes32. */

import { keccak256, encodePacked } from "viem";

function roundKey(novelId: string, votingRoundId: string): string {
  return `votes:${novelId}:${votingRoundId}`;
}

/** Convert any user salt to bytes32 for the contract.
 *  If already a valid 0x-prefixed 32-byte hex, use as-is.
 *  Otherwise hash the string to produce bytes32. */
export function toBytes32Salt(input: string): `0x${string}` {
  if (/^0x[0-9a-fA-F]{64}$/.test(input)) return input as `0x${string}`;
  return keccak256(encodePacked(["string"], [input])) as `0x${string}`;
}

/** Save vote. salt is the user-facing value (e.g. "6666" or a random hex). */
export function saveVote(novelId: string, votingRoundId: string, candidateId: string, salt: string) {
  const all = loadAllVotes(novelId, votingRoundId);
  all[candidateId] = salt;
  localStorage.setItem(roundKey(novelId, votingRoundId), JSON.stringify(all));
}

/** Load all votes for a round. Returns { candidateId → userSalt } map. */
export function loadAllVotes(novelId: string, votingRoundId: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  const raw = localStorage.getItem(roundKey(novelId, votingRoundId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    // Migrate old single-vote format { candidateId, salt }
    if (parsed.candidateId && parsed.salt && typeof parsed.salt === "string") {
      return { [parsed.candidateId]: parsed.salt };
    }
    return parsed;
  } catch {
    return {};
  }
}

/** Load user salt for a specific candidate. */
export function loadVote(novelId: string, votingRoundId: string, candidateId: string): string | null {
  return loadAllVotes(novelId, votingRoundId)[candidateId] ?? null;
}

export function hasVotedFor(novelId: string, votingRoundId: string, candidateId: string): boolean {
  return loadVote(novelId, votingRoundId, candidateId) !== null;
}

export function getVotedCandidateIds(novelId: string, votingRoundId: string): string[] {
  return Object.keys(loadAllVotes(novelId, votingRoundId));
}

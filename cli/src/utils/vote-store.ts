import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const STORE_DIR = join(homedir(), ".onchain-novel");
const STORE_FILE = join(STORE_DIR, "vote-salts.json");

interface VoteSaltRecord {
  novelId: string;
  round: number;
  candidateId: string;
  salt: `0x${string}`;
  voter: string;
  createdAt: number;
}

interface Store {
  // Key: `${novelId}:${round}:${voterLower}`
  [key: string]: VoteSaltRecord;
}

function load(): Store {
  if (!existsSync(STORE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STORE_FILE, "utf-8")) as Store;
  } catch {
    return {};
  }
}

// Atomic write: write to a unique temp file in the same directory, then rename.
// rename(2) is atomic on POSIX within a filesystem, so readers never observe a
// truncated file, and concurrent writers only lose their own update (not the
// whole store). This prevents losing committed salts when multiple CLI processes
// persist concurrently, which would otherwise be a 50%-stake forfeit.
function persist(store: Store): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${STORE_FILE}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, STORE_FILE);
}

function makeKey(novelId: bigint, round: number, voter: string): string {
  return `${novelId}:${round}:${voter.toLowerCase()}`;
}

export function saveVoteSalt(record: Omit<VoteSaltRecord, "createdAt">): void {
  const store = load();
  store[makeKey(BigInt(record.novelId), record.round, record.voter)] = {
    ...record,
    createdAt: Math.floor(Date.now() / 1000),
  };
  persist(store);
}

export function getVoteSalt(novelId: bigint, round: number, voter: string): VoteSaltRecord | null {
  const store = load();
  return store[makeKey(novelId, round, voter)] ?? null;
}

export function getStorePath(): string {
  return STORE_FILE;
}

/** Return all stored salts matching (novelId, voter), optionally also round. Used by `vote status`. */
export function listVoteSalts(novelId: bigint, voter: string, round?: number): VoteSaltRecord[] {
  const store = load();
  const voterLower = voter.toLowerCase();
  const prefix = `${novelId}:`;
  return Object.entries(store)
    .filter(([k, v]) => {
      if (!k.startsWith(prefix)) return false;
      if (v.voter.toLowerCase() !== voterLower) return false;
      if (round !== undefined && v.round !== round) return false;
      return true;
    })
    .map(([, v]) => v)
    .sort((a, b) => b.round - a.round || b.createdAt - a.createdAt);
}

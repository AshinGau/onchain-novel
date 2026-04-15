import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

function persist(store: Store): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(STORE_FILE, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
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

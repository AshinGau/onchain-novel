import { describe, it, expect, beforeEach } from "vitest";
import {
  saveVote,
  loadVote,
  clearVote,
  generateSalt,
  computeCommitHash,
} from "@/lib/vote-storage";

beforeEach(() => {
  localStorage.clear();
});

describe("generateSalt", () => {
  it("returns a 0x-prefixed 32-byte hex string (66 chars)", () => {
    const salt = generateSalt();
    expect(salt).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("returns a different value on each call (random)", () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a).not.toEqual(b);
  });
});

describe("computeCommitHash", () => {
  it("is deterministic for the same (candidateId, salt) pair", () => {
    const salt = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
    const a = computeCommitHash(42n, salt);
    const b = computeCommitHash(42n, salt);
    expect(a).toEqual(b);
  });

  it("differs when candidateId or salt changes", () => {
    const s1 = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
    const s2 = "0x0000000000000000000000000000000000000000000000000000000000000002" as const;
    expect(computeCommitHash(1n, s1)).not.toEqual(computeCommitHash(2n, s1));
    expect(computeCommitHash(1n, s1)).not.toEqual(computeCommitHash(1n, s2));
  });
});

describe("saveVote / loadVote / clearVote", () => {
  it("round-trips a stored vote", () => {
    const salt = generateSalt();
    saveVote("1", 1, "42", salt, true);
    const loaded = loadVote("1", 1);
    expect(loaded).not.toBeNull();
    expect(loaded?.candidateId).toBe("42");
    expect(loaded?.salt).toBe(salt);
    expect(loaded?.keeperSubmitted).toBe(true);
  });

  it("returns null for missing entries", () => {
    expect(loadVote("999", 999)).toBeNull();
  });

  it("clearVote removes the entry", () => {
    saveVote("1", 1, "42", generateSalt(), false);
    expect(loadVote("1", 1)).not.toBeNull();
    clearVote("1", 1);
    expect(loadVote("1", 1)).toBeNull();
  });

  it("keeps separate entries per (novel, round)", () => {
    const s1 = generateSalt();
    const s2 = generateSalt();
    saveVote("1", 1, "10", s1, true);
    saveVote("1", 2, "20", s2, false);
    expect(loadVote("1", 1)?.candidateId).toBe("10");
    expect(loadVote("1", 2)?.candidateId).toBe("20");
  });
});

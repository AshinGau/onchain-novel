import { beforeEach, describe, expect, it } from "vitest";

import { clearVote, computeCommitHash, generateSalt, loadVote, saveVote } from "@/lib/vote-storage";

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
  const voterA = "0x1111111111111111111111111111111111111111" as const;
  const voterB = "0x2222222222222222222222222222222222222222" as const;

  it("is deterministic for the same (voter, candidateId, salt) triple", () => {
    const salt = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
    const a = computeCommitHash(voterA, 42n, salt);
    const b = computeCommitHash(voterA, 42n, salt);
    expect(a).toEqual(b);
  });

  it("differs when voter, candidateId or salt changes", () => {
    const s1 = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
    const s2 = "0x0000000000000000000000000000000000000000000000000000000000000002" as const;
    expect(computeCommitHash(voterA, 1n, s1)).not.toEqual(computeCommitHash(voterA, 2n, s1));
    expect(computeCommitHash(voterA, 1n, s1)).not.toEqual(computeCommitHash(voterA, 1n, s2));
    // Voter binding: same (candidate, salt) under different voter must produce different hash
    expect(computeCommitHash(voterA, 1n, s1)).not.toEqual(computeCommitHash(voterB, 1n, s1));
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

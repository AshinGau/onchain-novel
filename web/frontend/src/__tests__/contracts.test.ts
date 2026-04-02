import { describe, it, expect } from "vitest";
import { computeVotingRoundId } from "@/lib/contracts";

describe("computeVotingRoundId", () => {
  it("produces consistent hash for same inputs", () => {
    const id1 = computeVotingRoundId(BigInt(1), 1, 1, false);
    const id2 = computeVotingRoundId(BigInt(1), 1, 1, false);
    expect(id1).toBe(id2);
  });

  it("produces different hash for round vs epoch", () => {
    const roundId = computeVotingRoundId(BigInt(1), 1, 1, false);
    const epochId = computeVotingRoundId(BigInt(1), 1, 1, true);
    expect(roundId).not.toBe(epochId);
  });

  it("produces different hash for different novels", () => {
    const id1 = computeVotingRoundId(BigInt(1), 1, 1, false);
    const id2 = computeVotingRoundId(BigInt(2), 1, 1, false);
    expect(id1).not.toBe(id2);
  });

  it("produces different hash for different rounds", () => {
    const id1 = computeVotingRoundId(BigInt(1), 1, 1, false);
    const id2 = computeVotingRoundId(BigInt(1), 1, 2, false);
    expect(id1).not.toBe(id2);
  });

  it("returns a numeric string (decimal)", () => {
    const id = computeVotingRoundId(BigInt(1), 1, 1, false);
    expect(() => BigInt(id)).not.toThrow();
    expect(BigInt(id) > BigInt(0)).toBe(true);
  });
});

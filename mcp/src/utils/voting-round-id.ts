import { keccak256, encodePacked } from "viem";

/**
 * Compute the votingRoundId matching the on-chain _computeVotingRoundId function:
 *   uint256(keccak256(abi.encodePacked(novelId, epoch, round, isEpoch)))
 *
 * @param novelId - Novel ID
 * @param epoch - Current epoch number (uint32)
 * @param round - Current round number (uint32)
 * @param isEpoch - Whether this is an epoch voting round
 * @returns The voting round ID as bigint
 */
export function computeVotingRoundId(
  novelId: bigint,
  epoch: number,
  round: number,
  isEpoch: boolean
): bigint {
  const hash = keccak256(
    encodePacked(
      ["uint256", "uint32", "uint32", "bool"],
      [novelId, epoch, round, isEpoch]
    )
  );
  return BigInt(hash);
}

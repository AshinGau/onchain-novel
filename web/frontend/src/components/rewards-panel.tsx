"use client";

import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { PRIZE_POOL_ADDRESS, VOTING_ENGINE_ADDRESS, NOVEL_CORE_ADDRESS, prizePoolAbi, votingEngineAbi, novelCoreAbi } from "@/lib/contracts";
import { formatEth } from "@/lib/format";

interface RewardsPanelProps {
  novelId: string;
  unclaimedVotingRounds?: { voting_round_id: string }[];
}

export function RewardsPanel({ novelId, unclaimedVotingRounds = [] }: RewardsPanelProps) {
  const { address, isConnected } = useAccount();

  const { data: pendingReward } = useReadContract({
    address: PRIZE_POOL_ADDRESS,
    abi: prizePoolAbi,
    functionName: "getPendingReward",
    args: address ? [BigInt(novelId), address] : undefined,
    query: { enabled: !!address },
  });

  const { data: claimableStake } = useReadContract({
    address: NOVEL_CORE_ADDRESS,
    abi: novelCoreAbi,
    functionName: "getClaimableStake",
    args: address ? [BigInt(novelId), address] : undefined,
    query: { enabled: !!address },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  if (!isConnected) {
    return null;
  }

  const pendingEth = pendingReward ? formatEth(pendingReward.toString()) : "0";
  const stakeEth = claimableStake ? formatEth(claimableStake.toString()) : "0";
  const hasRewards = (pendingReward && pendingReward > BigInt(0)) || (claimableStake && claimableStake > BigInt(0)) || unclaimedVotingRounds.length > 0;

  if (!hasRewards) return null;

  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4">
      <h3 className="font-semibold mb-3">Your Rewards</h3>

      <div className="space-y-3">
        {pendingReward && pendingReward > BigInt(0) && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Prize Pool Reward</p>
              <p className="text-amber-400 font-semibold">{pendingEth} ETH</p>
            </div>
            <Button
              size="sm"
              onClick={() => writeContract({
                address: PRIZE_POOL_ADDRESS,
                abi: prizePoolAbi,
                functionName: "claimReward",
                args: [BigInt(novelId)],
              })}
              disabled={isPending || isConfirming}
            >
              Claim
            </Button>
          </div>
        )}

        {claimableStake && claimableStake > BigInt(0) && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Stake Refund</p>
              <p className="text-green-400 font-semibold">{stakeEth} ETH</p>
            </div>
            <Button
              size="sm"
              onClick={() => writeContract({
                address: NOVEL_CORE_ADDRESS,
                abi: novelCoreAbi,
                functionName: "claimStakeRefund",
                args: [BigInt(novelId)],
              })}
              disabled={isPending || isConfirming}
            >
              Claim
            </Button>
          </div>
        )}

        {unclaimedVotingRounds.map(vr => (
          <div key={vr.voting_round_id} className="flex items-center justify-between">
            <p className="text-sm">Voting Reward (Round {vr.voting_round_id.slice(0, 8)}...)</p>
            <Button
              size="sm"
              onClick={() => writeContract({
                address: VOTING_ENGINE_ADDRESS,
                abi: votingEngineAbi,
                functionName: "claimVotingReward",
                args: [BigInt(novelId), BigInt(vr.voting_round_id)],
              })}
              disabled={isPending || isConfirming}
            >
              Claim
            </Button>
          </div>
        ))}
      </div>

      {isPending && <p className="text-neutral-400 text-sm mt-2">Waiting for signature...</p>}
      {isConfirming && <p className="text-neutral-400 text-sm mt-2">Confirming transaction...</p>}
      {isSuccess && <p className="text-green-400 text-sm mt-2">Claim successful!</p>}
      {error && <p className="text-red-400 text-sm mt-2">{error.message.slice(0, 80)}</p>}
    </div>
  );
}

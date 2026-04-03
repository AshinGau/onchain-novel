"use client";

import { useAccount, useReadContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { PRIZE_POOL_ADDRESS, VOTING_ENGINE_ADDRESS, NOVEL_CORE_ADDRESS, prizePoolAbi, votingEngineAbi, novelCoreAbi } from "@/lib/contracts";
import { TOKEN_SYMBOL } from "@/lib/config";
import { formatEth } from "@/lib/format";
import { useTxAction, txStatusLabel } from "@/hooks/use-tx-action";

interface RewardsPanelProps {
  novelId: string;
  unclaimedVotingRounds?: { voting_round_id: string }[];
}

function ClaimButton({ label, onClaim }: { label: string; onClaim: (write: ReturnType<typeof useTxAction>["writeContract"]) => void }) {
  const tx = useTxAction();
  return (
    <div>
      <Button size="sm" onClick={() => onClaim(tx.writeContract)} disabled={tx.isBusy}>
        {tx.isBusy ? txStatusLabel(tx.status, label) : tx.isSuccess ? "Claimed!" : label}
      </Button>
      {tx.isError && <p className="text-red-400 text-xs mt-1">{tx.error}</p>}
    </div>
  );
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

  if (!isConnected) return null;

  const pendingEth = pendingReward ? formatEth(pendingReward.toString()) : "0";
  const stakeEth = claimableStake ? formatEth(claimableStake.toString()) : "0";
  const hasPending = pendingReward !== undefined && pendingReward > BigInt(0);
  const hasStake = claimableStake !== undefined && claimableStake > BigInt(0);

  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4">
      <h3 className="font-semibold mb-3">Your Rewards</h3>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-400">Prize Pool Reward</p>
            <p className={`font-semibold ${hasPending ? "text-amber-400" : "text-neutral-600"}`}>{pendingEth} {TOKEN_SYMBOL}</p>
          </div>
          {hasPending && (
            <ClaimButton label="Claim" onClaim={(write) => write({
              address: PRIZE_POOL_ADDRESS, abi: prizePoolAbi,
              functionName: "claimReward", args: [BigInt(novelId)],
            })} />
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-400">Stake Refund</p>
            <p className={`font-semibold ${hasStake ? "text-green-400" : "text-neutral-600"}`}>{stakeEth} {TOKEN_SYMBOL}</p>
          </div>
          {hasStake && (
            <ClaimButton label="Claim" onClaim={(write) => write({
              address: NOVEL_CORE_ADDRESS, abi: novelCoreAbi,
              functionName: "claimStakeRefund", args: [BigInt(novelId)],
            })} />
          )}
        </div>

        {unclaimedVotingRounds.map(vr => (
          <div key={vr.voting_round_id} className="flex items-center justify-between">
            <p className="text-sm">Voting Reward (Round {vr.voting_round_id.slice(0, 8)}...)</p>
            <ClaimButton label="Claim" onClaim={(write) => write({
              address: VOTING_ENGINE_ADDRESS, abi: votingEngineAbi,
              functionName: "claimVotingReward", args: [BigInt(novelId), BigInt(vr.voting_round_id)],
            })} />
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useAccount, useReadContract } from "wagmi";
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
      <button className="btn btn-primary btn-sm" onClick={() => onClaim(tx.writeContract)} disabled={tx.isBusy}>
        {tx.isBusy ? txStatusLabel(tx.status, label) : tx.isSuccess ? "Claimed!" : label}
      </button>
      {tx.isError && <div className="text-danger small mt-1">{tx.error}</div>}
    </div>
  );
}

export function RewardsPanel({ novelId, unclaimedVotingRounds = [] }: RewardsPanelProps) {
  const { address, isConnected } = useAccount();

  const { data: pendingReward } = useReadContract({
    address: PRIZE_POOL_ADDRESS, abi: prizePoolAbi, functionName: "getPendingReward",
    args: address ? [BigInt(novelId), address] : undefined, query: { enabled: !!address },
  });

  const { data: claimableStake } = useReadContract({
    address: NOVEL_CORE_ADDRESS, abi: novelCoreAbi, functionName: "getClaimableStake",
    args: address ? [BigInt(novelId), address] : undefined, query: { enabled: !!address },
  });

  if (!isConnected) return null;

  const pendingEth = pendingReward ? formatEth(pendingReward.toString()) : "0";
  const stakeEth = claimableStake ? formatEth(claimableStake.toString()) : "0";
  const hasPending = pendingReward !== undefined && pendingReward > BigInt(0);
  const hasStake = claimableStake !== undefined && claimableStake > BigInt(0);

  return (
    <div className="card">
      <div className="card-body">
        <h6 className="card-title">Your Rewards</h6>
        <div className="d-flex flex-column gap-2">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <div className="small text-body-secondary">Prize Pool Reward</div>
              <div className={`fw-semibold ${hasPending ? "text-warning" : "text-body-tertiary"}`}>{pendingEth} {TOKEN_SYMBOL}</div>
            </div>
            {hasPending && <ClaimButton label="Claim" onClaim={(write) => write({ address: PRIZE_POOL_ADDRESS, abi: prizePoolAbi, functionName: "claimReward", args: [BigInt(novelId)] })} />}
          </div>

          <div className="d-flex justify-content-between align-items-center">
            <div>
              <div className="small text-body-secondary">Stake Refund</div>
              <div className={`fw-semibold ${hasStake ? "text-success" : "text-body-tertiary"}`}>{stakeEth} {TOKEN_SYMBOL}</div>
            </div>
            {hasStake && <ClaimButton label="Claim" onClaim={(write) => write({ address: NOVEL_CORE_ADDRESS, abi: novelCoreAbi, functionName: "claimStakeRefund", args: [BigInt(novelId)] })} />}
          </div>

          {unclaimedVotingRounds.map(vr => (
            <div key={vr.voting_round_id} className="d-flex justify-content-between align-items-center">
              <span className="small">Voting Reward (Round {vr.voting_round_id.slice(0, 8)}...)</span>
              <ClaimButton label="Claim" onClaim={(write) => write({ address: VOTING_ENGINE_ADDRESS, abi: votingEngineAbi, functionName: "claimVotingReward", args: [BigInt(novelId), BigInt(vr.voting_round_id)] })} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { useTxAction, txStatusLabel } from "@/hooks/use-tx-action";

interface PhaseTransitionProps {
  novelId: string; roundPhase: number; epochPhase: number; phaseStartTime: string;
  config: { roundMinDuration: string; commitDuration: string; revealDuration: string; roundMinSubmissions: number };
  currentRoundSubmissions?: number;
}

type TransitionInfo = { fn: string; label: string; description: string; deadline: number };

function getTransition(props: PhaseTransitionProps): TransitionInfo | null {
  const start = Number(props.phaseStartTime) * 1000;
  if (!start || isNaN(start)) return null;
  const { roundPhase, epochPhase, config } = props;
  if (epochPhase === 0) {
    if (roundPhase === 0) return { fn: "closeSubmissions", label: "Close Submissions", description: "End the submission phase and start voting.", deadline: start + Number(config.roundMinDuration) * 1000 };
    if (roundPhase === 1) return { fn: "closeCommit", label: "Close Commit Phase", description: "End the commit phase and start the reveal phase.", deadline: start + Number(config.commitDuration) * 1000 };
    if (roundPhase === 2) return { fn: "settleRound", label: "Settle Round", description: "Tally votes and select world lines for the next round.", deadline: start + Number(config.revealDuration) * 1000 };
  }
  if (epochPhase === 1) return { fn: "closeEpochCommit", label: "Close Epoch Commit", description: "End the epoch commit phase and start reveal.", deadline: start + Number(config.commitDuration) * 1000 };
  if (epochPhase === 2) return { fn: "settleEpoch", label: "Settle Epoch", description: "Tally epoch votes, establish canon, distribute rewards, and mint NFTs.", deadline: start + Number(config.revealDuration) * 1000 };
  return null;
}

export function PhaseTransition(props: PhaseTransitionProps) {
  const router = useRouter();
  const transition = getTransition(props);
  const tx = useTxAction({ onSuccess: () => { setTimeout(() => router.refresh(), 3000); } });

  if (!transition) return null;
  if (Date.now() < transition.deadline) return null;

  const needsMoreSubmissions = transition.fn === "closeSubmissions" && (props.currentRoundSubmissions ?? 0) < props.config.roundMinSubmissions;

  function handleClick() {
    if (!transition) return;
    tx.writeContract({ address: NOVEL_CORE_ADDRESS, abi: novelCoreAbi, functionName: transition.fn as any, args: [BigInt(props.novelId)] });
  }

  return (
    <div className="alert alert-warning d-flex justify-content-between align-items-center mb-3">
      <div>
        <strong>{transition.description}</strong>
        {needsMoreSubmissions ? (
          <p className="mb-0 small text-body-secondary">Waiting for submissions: {props.currentRoundSubmissions ?? 0} / {props.config.roundMinSubmissions} required.</p>
        ) : (
          <p className="mb-0 small text-body-secondary">Anyone can trigger this transition and earn a keeper reward.</p>
        )}
        {tx.isSuccess && <p className="mb-0 small text-success mt-1">Transition successful! Refreshing...</p>}
        {tx.isError && <p className="mb-0 small text-danger mt-1">{tx.error}</p>}
      </div>
      <button onClick={handleClick} disabled={tx.isBusy || needsMoreSubmissions}
        className="btn btn-warning btn-sm flex-shrink-0 ms-3">
        {tx.isBusy ? txStatusLabel(tx.status, transition.label) : transition.label}
      </button>
    </div>
  );
}

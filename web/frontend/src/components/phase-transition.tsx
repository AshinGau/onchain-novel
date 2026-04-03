"use client";

import { useRouter } from "next/navigation";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import { useTxAction, txStatusLabel } from "@/hooks/use-tx-action";

interface PhaseTransitionProps {
  novelId: string;
  roundPhase: number;
  epochPhase: number;
  phaseStartTime: string;
  config: {
    roundMinDuration: string;
    commitDuration: string;
    revealDuration: string;
    roundMinSubmissions: number;
  };
  /** Current round submission count (for closeSubmissions check) */
  currentRoundSubmissions?: number;
}

type TransitionInfo = {
  fn: "closeSubmissions" | "closeCommit" | "settleRound" | "closeEpochCommit" | "settleEpoch";
  label: string;
  description: string;
  deadline: number;
};

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

  const tx = useTxAction({
    onSuccess: () => { setTimeout(() => router.refresh(), 3000); },
  });

  if (!transition) return null;
  if (Date.now() < transition.deadline) return null;

  // closeSubmissions also requires enough submissions
  const needsMoreSubmissions = transition.fn === "closeSubmissions"
    && (props.currentRoundSubmissions ?? 0) < props.config.roundMinSubmissions;

  function handleClick() {
    if (!transition) return;
    tx.writeContract({
      address: NOVEL_CORE_ADDRESS,
      abi: novelCoreAbi,
      functionName: transition.fn,
      args: [BigInt(props.novelId)],
    });
  }

  return (
    <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4 mb-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-amber-300">{transition.description}</p>
          {needsMoreSubmissions ? (
            <p className="text-xs text-neutral-400 mt-0.5">
              Waiting for submissions: {props.currentRoundSubmissions ?? 0} / {props.config.roundMinSubmissions} required.
            </p>
          ) : (
            <p className="text-xs text-neutral-500 mt-0.5">Anyone can trigger this transition and earn a keeper reward.</p>
          )}
        </div>
        <button
          onClick={handleClick}
          disabled={tx.isBusy || needsMoreSubmissions}
          className="shrink-0 rounded-lg bg-amber-600 text-black font-semibold px-4 py-2 text-sm hover:bg-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={needsMoreSubmissions ? "Not enough submissions yet" : undefined}
        >
          {tx.isBusy ? txStatusLabel(tx.status, transition.label) : transition.label}
        </button>
      </div>
      {tx.isSuccess && <p className="text-xs text-green-400 mt-2">Transition successful! Refreshing...</p>}
      {tx.isError && (
        <div className="flex items-center gap-2 mt-2">
          <p className="text-xs text-red-400">{tx.error}</p>
          <button onClick={tx.reset} className="text-xs text-neutral-400 hover:text-white underline">Retry</button>
        </div>
      )}
    </div>
  );
}

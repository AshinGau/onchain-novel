"use client";

import { useState, useEffect } from "react";
import { parseEther, keccak256, encodePacked, toHex } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { VOTING_ENGINE_ADDRESS, votingEngineAbi } from "@/lib/contracts";
import { TOKEN_SYMBOL, DEFAULT_STAKE } from "@/lib/config";
import { saveVote, hasVotedFor, loadVote, toBytes32Salt } from "@/lib/vote-storage";
import { useTxAction } from "@/hooks/use-tx-action";

function generateRandomSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

interface VoteButtonProps {
  novelId: string;
  chapterId: string;
  votingRoundId: string;
  phase: "committing" | "revealing";
}

export function VoteButton({ novelId, chapterId, votingRoundId, phase }: VoteButtonProps) {
  const { isConnected, address } = useAccount();
  const [stakeAmount, setStakeAmount] = useState(DEFAULT_STAKE);
  const [saltMode, setSaltMode] = useState<"auto" | "custom">("auto");
  const [customSalt, setCustomSalt] = useState("");
  const [committed, setCommitted] = useState(false);
  const [pendingSalt, setPendingSalt] = useState<string | null>(null);

  // Check on-chain commit status — always, not just during reveal
  const { data: onChainCommit, refetch } = useReadContract({
    address: VOTING_ENGINE_ADDRESS,
    abi: votingEngineAbi,
    functionName: "getVoteCommit",
    args: address ? [BigInt(novelId), BigInt(votingRoundId), address] : undefined,
    query: { enabled: !!address },
  });

  const onChainCommitHash = (onChainCommit as any)?.commitHash as string | undefined;
  const onChainRevealed = !!(onChainCommit as any)?.revealed;
  const alreadyCommittedOnChain = !!onChainCommitHash && onChainCommitHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  const localVotedThis = typeof window !== "undefined" && hasVotedFor(novelId, votingRoundId, chapterId);
  const localSalt = typeof window !== "undefined" ? loadVote(novelId, votingRoundId, chapterId) : null;

  const commitTx = useTxAction({
    onSuccess: () => {
      if (pendingSalt) {
        saveVote(novelId, votingRoundId, chapterId, pendingSalt);
        setCommitted(true);
        setPendingSalt(null);
        refetch();
      }
    },
  });

  const revealTx = useTxAction({ onSuccess: () => refetch() });

  function handleCommit() {
    const userSalt = (saltMode === "custom" && customSalt.trim()) ? customSalt.trim() : generateRandomSalt();
    const bytes32 = toBytes32Salt(userSalt);
    const commitHash = keccak256(encodePacked(["uint256", "bytes32"], [BigInt(chapterId), bytes32]));
    setPendingSalt(userSalt);
    commitTx.writeContract({
      address: VOTING_ENGINE_ADDRESS,
      abi: votingEngineAbi,
      functionName: "commitVote",
      args: [BigInt(novelId), BigInt(votingRoundId), commitHash],
      value: parseEther(stakeAmount),
    });
  }

  function handleReveal() {
    if (!localSalt) return;
    const bytes32 = toBytes32Salt(localSalt);
    revealTx.writeContract({
      address: VOTING_ENGINE_ADDRESS,
      abi: votingEngineAbi,
      functionName: "revealVote",
      args: [BigInt(novelId), BigInt(votingRoundId), BigInt(chapterId), bytes32],
    });
  }

  if (!isConnected) {
    return <p className="text-xs text-amber-400">Connect wallet to vote for this chapter</p>;
  }

  if (phase === "committing") {
    // Already committed on-chain (via any method)
    if (alreadyCommittedOnChain) {
      if (localVotedThis) {
        return <p className="text-sm text-green-400">&#10003; You voted for this chapter</p>;
      }
      return <p className="text-sm text-neutral-400">&#10003; You already voted this round (one vote per address).</p>;
    }

    if (commitTx.isBusy) {
      return <p className="text-sm text-neutral-400">{commitTx.isPending ? "Waiting for signature..." : "Confirming..."}</p>;
    }

    if (committed && localSalt) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-green-400">&#10003; Vote committed!</p>
          <div className="rounded-md border border-amber-800 bg-amber-950/30 p-3 text-xs space-y-1">
            <p className="text-amber-300 font-medium">Secret key (needed to reveal &amp; recover stake):</p>
            <code className="block bg-neutral-900 rounded px-2 py-1 text-neutral-300 break-all select-all">{localSalt}</code>
            <p className="text-neutral-500">Saved in your browser. Back it up if you may clear data or switch devices.</p>
            <button onClick={() => navigator.clipboard.writeText(localSalt)} className="text-blue-400 hover:text-blue-300 underline">Copy</button>
          </div>
        </div>
      );
    }

    if (commitTx.isError) {
      return (
        <div className="space-y-2">
          <p className="text-xs text-red-400">{commitTx.error}</p>
          <Button size="sm" variant="outline" onClick={commitTx.reset}>Try again</Button>
        </div>
      );
    }

    // Show vote form
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-neutral-400">Stake:</label>
          <input type="number" step="0.001" min="0.001" value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            className="w-24 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm" />
          <span className="text-sm text-neutral-400">{TOKEN_SYMBOL}</span>
        </div>
        <div className="text-xs space-y-1">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={saltMode === "auto"} onChange={() => setSaltMode("auto")} className="accent-white" />
              <span className="text-neutral-400">Auto-generate secret key</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={saltMode === "custom"} onChange={() => setSaltMode("custom")} className="accent-white" />
              <span className="text-neutral-400">Custom secret key</span>
            </label>
          </div>
          {saltMode === "custom" && (
            <input type="text" value={customSalt} onChange={(e) => setCustomSalt(e.target.value)}
              placeholder="Enter a memorable secret phrase..."
              className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm" />
          )}
        </div>
        <Button size="sm" onClick={handleCommit} disabled={saltMode === "custom" && !customSalt.trim()}>
          Vote for this
        </Button>
      </div>
    );
  }

  // Revealing phase
  if (revealTx.isSuccess || onChainRevealed) {
    return <p className="text-sm text-green-400">&#10003; Vote revealed!</p>;
  }

  if (!alreadyCommittedOnChain) {
    return <p className="text-sm text-neutral-500">You did not vote in this round.</p>;
  }

  if (!localVotedThis) {
    return <p className="text-sm text-neutral-500">You voted this round but not for this chapter.</p>;
  }

  return (
    <div className="space-y-1">
      <Button size="sm" onClick={handleReveal} disabled={revealTx.isBusy}>
        {revealTx.isBusy ? (revealTx.isPending ? "Signing..." : "Confirming...") : "Reveal vote"}
      </Button>
      <p className="text-xs text-neutral-500">Reveal to make your vote count and recover your stake.</p>
      {revealTx.isError && <p className="text-xs text-red-400">{revealTx.error}</p>}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { TOKEN_SYMBOL, DEFAULT_STAKE } from "@/lib/config";
import { saveVote, hasVotedFor, loadVote } from "@/lib/vote-storage";
import { useVote } from "@/hooks/use-vote";

interface VoteButtonProps {
  novelId: string;
  chapterId: string;
  votingRoundId: string;
  phase: "committing" | "revealing";
}

export function VoteButton({ novelId, chapterId, votingRoundId, phase }: VoteButtonProps) {
  const [stakeAmount, setStakeAmount] = useState(DEFAULT_STAKE);
  const [secretKey, setSecretKey] = useState("");
  const [revealSecretKey, setRevealSecretKey] = useState("");
  const [committed, setCommitted] = useState(false);
  const [pendingSalt, setPendingSalt] = useState<string | null>(null);

  const { isConnected, alreadyCommitted, onChainRevealed, commitTx, revealTx, commit, reveal } = useVote({
    novelId,
    votingRoundId,
    onCommitSuccess: () => {
      if (pendingSalt) {
        saveVote(novelId, votingRoundId, chapterId, pendingSalt);
        setCommitted(true);
        setPendingSalt(null);
      }
    },
  });

  const localVotedThis = typeof window !== "undefined" && hasVotedFor(novelId, votingRoundId, chapterId);
  const localSalt = typeof window !== "undefined" ? loadVote(novelId, votingRoundId, chapterId) : null;

  useEffect(() => {
    if (localSalt && !revealSecretKey) setRevealSecretKey(localSalt);
  }, [localSalt]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCommit() {
    const userSalt = secretKey.trim();
    if (!userSalt) return;
    setPendingSalt(userSalt);
    commit(chapterId, userSalt, stakeAmount);
  }

  function handleReveal() {
    const salt = revealSecretKey.trim();
    if (!salt) return;
    reveal(chapterId, salt);
  }

  if (!isConnected) {
    return <p className="text-xs text-amber-400">Connect wallet to vote for this chapter</p>;
  }

  if (phase === "committing") {
    if (alreadyCommitted) {
      if (localVotedThis) return <p className="text-sm text-green-400">&#10003; You voted for this chapter</p>;
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

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-neutral-400">Stake:</label>
          <input type="number" step="0.001" min="0.001" value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            className="w-24 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm" />
          <span className="text-sm text-neutral-400">{TOKEN_SYMBOL}</span>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm text-neutral-400">Secret Key</label>
          <input type="text" value={secretKey} onChange={(e) => setSecretKey(e.target.value)}
            placeholder="Enter a secret key you can remember..."
            className="w-72 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm" />
          {secretKey.trim().length > 0 && secretKey.trim().length < 4 && (
            <p className="text-amber-400 text-xs">Short keys are easier to brute-force — others may guess your vote before reveal.</p>
          )}
          <p className="text-neutral-500 text-xs">You will need this exact key to reveal your vote. It is only stored in your browser as a backup.</p>
        </div>
        <Button size="sm" onClick={handleCommit} disabled={!secretKey.trim()}>
          {secretKey.trim() ? "Vote for this" : "Enter a Secret Key"}
        </Button>
      </div>
    );
  }

  // Revealing phase
  if (revealTx.isSuccess || onChainRevealed) {
    return <p className="text-sm text-green-400">&#10003; Vote revealed!</p>;
  }

  if (!alreadyCommitted) return <p className="text-sm text-neutral-500">You did not vote in this round.</p>;
  if (!localVotedThis) return <p className="text-sm text-neutral-500">You voted this round but not for this chapter.</p>;

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <label className="text-sm text-neutral-400">Secret Key </label>
        <input type="text" value={revealSecretKey} onChange={(e) => setRevealSecretKey(e.target.value)}
          placeholder="Enter the secret key you used when voting..."
          className="w-78 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm" />
      </div>
      <Button size="sm" onClick={handleReveal} disabled={revealTx.isBusy || !revealSecretKey.trim()}>
        {revealTx.isBusy ? (revealTx.isPending ? "Signing..." : "Confirming...") : !revealSecretKey.trim() ? "Enter Secret Key" : "Reveal vote"}
      </Button>
      {revealTx.isError && <p className="text-xs text-red-400">{revealTx.error}</p>}
    </div>
  );
}

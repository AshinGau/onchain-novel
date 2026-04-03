"use client";

import { useState, useEffect } from "react";
import { parseEther, keccak256, encodePacked, toHex } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { VOTING_ENGINE_ADDRESS, votingEngineAbi } from "@/lib/contracts";
import { TOKEN_SYMBOL, DEFAULT_STAKE } from "@/lib/config";
import { shortenAddress } from "@/lib/format";
import { saveVote, loadAllVotes, toBytes32Salt } from "@/lib/vote-storage";
import { useTxAction } from "@/hooks/use-tx-action";

interface VoteCandidate {
  id: string;
  author: string;
  chapter_index: number;
  vote_count: string;
  is_world_line: boolean;
}

interface VotePanelProps {
  novelId: string;
  votingRoundId: string;
  phase: "committing" | "revealing";
  candidates: VoteCandidate[];
  title?: string;
}

function generateRandomSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function VotePanel({ novelId, votingRoundId, phase, candidates, title }: VotePanelProps) {
  const { isConnected, address } = useAccount();
  const [localVotes, setLocalVotes] = useState<Record<string, string>>({});
  const [stakeAmount, setStakeAmount] = useState(DEFAULT_STAKE);
  const [saltMode, setSaltMode] = useState<"auto" | "custom">("auto");
  const [customSalt, setCustomSalt] = useState("");
  const [justCommittedId, setJustCommittedId] = useState<string | null>(null);

  // Always check on-chain commit status for this address + round
  const { data: onChainCommit, refetch: refetchCommit } = useReadContract({
    address: VOTING_ENGINE_ADDRESS,
    abi: votingEngineAbi,
    functionName: "getVoteCommit",
    args: address ? [BigInt(novelId), BigInt(votingRoundId), address] : undefined,
    query: { enabled: !!address },
  });

  const onChainCommitHash = (onChainCommit as any)?.commitHash as string | undefined;
  const onChainRevealed = !!(onChainCommit as any)?.revealed;
  // Has this address already committed on-chain? (commitHash != bytes32(0))
  const alreadyCommittedOnChain = !!onChainCommitHash && onChainCommitHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  useEffect(() => {
    setLocalVotes(loadAllVotes(novelId, votingRoundId));
  }, [novelId, votingRoundId]);

  // Figure out which candidate the user voted for (from localStorage)
  const votedCandidateIds = Object.keys(localVotes);

  const commitTx = useTxAction({
    onSuccess: () => {
      if (pendingCommit) {
        saveVote(novelId, votingRoundId, pendingCommit.candidateId, pendingCommit.userSalt);
        setLocalVotes((prev) => ({ ...prev, [pendingCommit!.candidateId]: pendingCommit!.userSalt }));
        setJustCommittedId(pendingCommit.candidateId);
        setPendingCommit(null);
        refetchCommit();
      }
    },
  });

  const revealTx = useTxAction({
    onSuccess: () => refetchCommit(),
  });

  const [pendingCommit, setPendingCommit] = useState<{ candidateId: string; userSalt: string } | null>(null);

  function handleCommit(candidateId: string) {
    const userSalt = (saltMode === "custom" && customSalt.trim()) ? customSalt.trim() : generateRandomSalt();
    const bytes32 = toBytes32Salt(userSalt);
    const commitHash = keccak256(encodePacked(["uint256", "bytes32"], [BigInt(candidateId), bytes32]));
    setPendingCommit({ candidateId, userSalt });
    commitTx.writeContract({
      address: VOTING_ENGINE_ADDRESS,
      abi: votingEngineAbi,
      functionName: "commitVote",
      args: [BigInt(novelId), BigInt(votingRoundId), commitHash],
      value: parseEther(stakeAmount),
    });
    setSaltMode("auto");
    setCustomSalt("");
  }

  function handleReveal() {
    // Use the first local vote's salt for reveal
    const candidateId = votedCandidateIds[0];
    const userSalt = localVotes[candidateId];
    if (!candidateId || !userSalt) return;
    const bytes32 = toBytes32Salt(userSalt);
    revealTx.writeContract({
      address: VOTING_ENGINE_ADDRESS,
      abi: votingEngineAbi,
      functionName: "revealVote",
      args: [BigInt(novelId), BigInt(votingRoundId), BigInt(candidateId), bytes32],
    });
  }

  // Determine if user can still vote (not committed on-chain, not pending)
  const canVote = isConnected && phase === "committing" && !alreadyCommittedOnChain && !commitTx.isBusy && !justCommittedId;

  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4">
      <h3 className="font-semibold mb-3">
        {title || (phase === "committing" ? "Cast Your Vote" : "Reveal Your Vote")}
      </h3>

      {/* Candidate list */}
      <div className="space-y-2 mb-4">
        {candidates.map((c) => {
          const isVotedLocally = votedCandidateIds.includes(c.id);
          return (
            <div key={c.id} className={`rounded-md border p-3 text-sm transition-colors ${
              isVotedLocally ? "border-green-700 bg-green-950/20" : "border-neutral-700 bg-neutral-800"
            }`}>
              <div className="flex items-center justify-between">
                <span>Candidate(ID.{c.id}) by {shortenAddress(c.author)}</span>
                <div className="flex items-center gap-2">
                  {isVotedLocally && <span className="text-green-400 text-xs">&#10003; Voted</span>}
                  {Number(c.vote_count) > 0 && <span className="text-neutral-500 text-xs">{c.vote_count} votes</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Commit UI */}
      {phase === "committing" && (
        <>
          {!isConnected && (
            <p className="text-amber-400 text-sm">Connect wallet to vote</p>
          )}

          {isConnected && alreadyCommittedOnChain && !justCommittedId && (
            <p className="text-green-400 text-sm">&#10003; You have already voted this round. One vote per address per round.</p>
          )}

          {justCommittedId && localVotes[justCommittedId] && (
            <div className="rounded-md border border-amber-800 bg-amber-950/30 p-3 text-xs space-y-1">
              <p className="text-green-400 text-sm font-medium">&#10003; Vote committed!</p>
              <p className="text-amber-300 font-medium mt-2">Secret key (needed to reveal &amp; recover stake):</p>
              <code className="block bg-neutral-900 rounded px-2 py-1 text-neutral-300 break-all select-all">{localVotes[justCommittedId]}</code>
              <p className="text-neutral-500">Saved in your browser. Back it up if you may clear data or switch devices.</p>
              <button onClick={() => navigator.clipboard.writeText(localVotes[justCommittedId])} className="text-blue-400 hover:text-blue-300 underline">Copy</button>
            </div>
          )}

          {commitTx.isBusy && (
            <p className="text-neutral-400 text-sm">{commitTx.isPending ? "Waiting for signature..." : "Confirming on-chain..."}</p>
          )}

          {commitTx.isError && (
            <div className="space-y-1">
              <p className="text-red-400 text-xs">{commitTx.error}</p>
              <button onClick={commitTx.reset} className="text-xs text-neutral-400 hover:text-white underline">Dismiss</button>
            </div>
          )}

          {canVote && (
            <div className="space-y-3 border-t border-neutral-700 pt-3">
              <p className="text-xs text-neutral-400">Select a candidate above to read, then vote here. One vote per address per round.</p>
              <div className="flex items-center gap-2 flex-wrap">
                {candidates.map((c) => (
                  <button key={c.id} onClick={() => handleCommit(c.id)}
                    disabled={commitTx.isBusy}
                    className="rounded-md border border-neutral-600 px-3 py-1.5 text-xs hover:border-amber-500 hover:bg-amber-950/20 transition-colors disabled:opacity-50">
                    Vote #{c.id}
                  </button>
                ))}
              </div>
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
            </div>
          )}
        </>
      )}

      {/* Reveal UI */}
      {phase === "revealing" && (
        <>
          {!isConnected && (
            <p className="text-amber-400 text-sm">Connect wallet to reveal your vote</p>
          )}

          {isConnected && onChainRevealed && (
            <p className="text-green-400 text-sm">&#10003; Vote revealed!</p>
          )}

          {isConnected && !onChainRevealed && alreadyCommittedOnChain && votedCandidateIds.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-neutral-300">
                You voted for <span className="text-amber-400">Candidate(ID.{votedCandidateIds[0]})</span>. Reveal to make it count and recover your stake.
              </p>
              <Button size="sm" onClick={handleReveal} disabled={revealTx.isBusy}>
                {revealTx.isBusy ? (revealTx.isPending ? "Signing..." : "Confirming...") : "Reveal Vote"}
              </Button>
              {revealTx.isError && <p className="text-red-400 text-xs">{revealTx.error}</p>}
            </div>
          )}

          {isConnected && !onChainRevealed && alreadyCommittedOnChain && votedCandidateIds.length === 0 && (
            <p className="text-neutral-500 text-sm">
              You committed a vote but the secret key is not saved in this browser. If you have it backed up, enter it on the chapter page.
            </p>
          )}

          {isConnected && !alreadyCommittedOnChain && (
            <p className="text-neutral-500 text-sm">You did not vote in this round.</p>
          )}
        </>
      )}
    </div>
  );
}

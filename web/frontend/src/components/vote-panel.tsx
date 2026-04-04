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
  content_text?: string | null;
  comment_count?: string | number;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        setSelectedId(null);
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

  function handleSubmitVote() {
    if (!selectedId) return;
    handleCommit(selectedId);
  }

  // Determine if user can still vote (not committed on-chain, not pending)
  const canVote = isConnected && phase === "committing" && !alreadyCommittedOnChain && !commitTx.isBusy && !justCommittedId;

  const selectedCandidate = candidates.find((c) => c.id === selectedId);

  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4">
      <h3 className="font-semibold mb-3">
        {title || (phase === "committing" ? "Cast Your Vote" : "Reveal Your Vote")}
      </h3>

      {/* Candidate list — clickable to select */}
      <div className="space-y-2 mb-4">
        {candidates.map((c) => {
          const isVotedLocally = votedCandidateIds.includes(c.id);
          const isSelected = selectedId === c.id;
          const commentCount = Number(c.comment_count || 0);

          return (
            <div
              key={c.id}
              onClick={() => {
                if (canVote && !isVotedLocally) {
                  setSelectedId(isSelected ? null : c.id);
                }
              }}
              className={`rounded-md border p-3 text-sm transition-all duration-150 ${isVotedLocally
                  ? "border-green-700 bg-green-950/20"
                  : isSelected
                    ? "border-amber-500 bg-amber-950/25 shadow-[0_0_8px_rgba(245,158,11,0.1)]"
                    : canVote
                      ? "border-neutral-700 bg-neutral-800 hover:border-neutral-500 cursor-pointer"
                      : "border-neutral-700 bg-neutral-800"
                }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span>Candidate(ID.{c.id}) by {shortenAddress(c.author)}</span>
                  {isSelected && (
                    <a
                      href={`/chapters/${c.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-400 hover:text-blue-300 text-xs underline underline-offset-2 flex-shrink-0"
                    >
                      View full
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                  {isVotedLocally && <span className="text-green-400 text-xs">&#10003; Voted</span>}
                  <span className="text-neutral-500 text-xs flex items-center gap-1" title="Comments">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 2A1.5 1.5 0 001 3.5v7A1.5 1.5 0 002.5 12h1v2.5l3.5-2.5h6A1.5 1.5 0 0015 10.5v-7A1.5 1.5 0 0013.5 2h-11z" /></svg>
                    {commentCount}
                  </span>
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

              {/* Content preview of selected candidate */}
              {selectedCandidate && (
                <div className="rounded-md border border-neutral-700 bg-neutral-800/60 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-neutral-400 font-medium">Selected: Candidate(ID.{selectedCandidate.id})</span>
                  </div>
                  {selectedCandidate.content_text ? (
                    <p className="text-sm text-neutral-300 leading-relaxed">
                      {selectedCandidate.content_text.length > 100
                        ? selectedCandidate.content_text.slice(0, 100) + "…"
                        : selectedCandidate.content_text}
                    </p>
                  ) : (
                    <p className="text-sm text-neutral-500 italic">Content not yet fetched.</p>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <label className="text-sm text-neutral-400">Stake:</label>
                <input type="number" step="0.001" min="0.001" value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  className="w-24 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm" />
                <span className="text-sm text-neutral-400">{TOKEN_SYMBOL}</span>
              </div>
              <details className="rounded-md border border-neutral-700 bg-neutral-800/40 text-xs">
                <summary className="px-3 py-2 cursor-pointer text-neutral-400 hover:text-neutral-300 select-none">
                  How voting works (commit-reveal)
                </summary>
                <div className="px-3 pb-3 space-y-2 text-neutral-400 leading-relaxed">
                  <div>
                    <span className="text-neutral-300 font-medium">1. Stake</span>
                    <p>You deposit a small amount of {TOKEN_SYMBOL} as a stake to cast your vote. This prevents spam and ensures voters have skin in the game. Your stake is returned when you reveal.</p>
                  </div>
                  <div>
                    <span className="text-neutral-300 font-medium">2. Secret Key</span>
                    <p>A secret key is generated (or you provide your own) and combined with your vote to create a hidden commitment. <span className="text-amber-400">Keep this key safe</span> — you need it to reveal your vote later. It is saved in your browser automatically, but back it up if you may switch devices or clear data.</p>
                  </div>
                  <div>
                    <span className="text-neutral-300 font-medium">3. Reveal</span>
                    <p>After the commit phase ends, a reveal phase begins. You must reveal your vote during this window by submitting your secret key on-chain. This proves your vote without allowing others to copy it beforehand.</p>
                  </div>
                  <div>
                    <span className="text-neutral-300 font-medium">4. Rewards</span>
                    <p>If you voted for the winning candidate and revealed on time, you recover your full stake plus a share of the voter reward pool. Unrevealed votes forfeit their stake. You can claim rewards from the Rewards panel below.</p>
                  </div>
                </div>
              </details>
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
              <Button
                onClick={handleSubmitVote}
                disabled={!selectedId || commitTx.isBusy}
                className="bg-amber-600 text-black font-semibold hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {commitTx.isBusy
                  ? (commitTx.isPending ? "Signing..." : "Confirming...")
                  : selectedId
                    ? `Submit Vote ID.${selectedId}`
                    : "Select a Candidate Above"}
              </Button>
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

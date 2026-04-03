"use client";

import { useState, useEffect } from "react";
import { parseEther, keccak256, encodePacked, toHex } from "viem";
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VOTING_ENGINE_ADDRESS, votingEngineAbi } from "@/lib/contracts";
import { shortenAddress } from "@/lib/format";

interface VoteCandidate {
  id: string;
  author: string;
  chapter_index: number;
  vote_count: string;
  is_world_line: boolean;
  content_text?: string | null;
}

interface VotePanelProps {
  novelId: string;
  votingRoundId: string;
  phase: "committing" | "revealing";
  candidates: VoteCandidate[];
  title?: string;
}

function generateSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes) as `0x${string}`;
}

function getStorageKey(novelId: string, votingRoundId: string): string {
  return `vote:${novelId}:${votingRoundId}`;
}

function saveVoteData(novelId: string, votingRoundId: string, candidateId: string, salt: string) {
  localStorage.setItem(getStorageKey(novelId, votingRoundId), JSON.stringify({ candidateId, salt }));
}

function loadVoteData(novelId: string, votingRoundId: string): { candidateId: string; salt: string } | null {
  const raw = localStorage.getItem(getStorageKey(novelId, votingRoundId));
  return raw ? JSON.parse(raw) : null;
}

export function VotePanel({ novelId, votingRoundId, phase, candidates, title }: VotePanelProps) {
  const { isConnected } = useAccount();
  const [selected, setSelected] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState("0.01");
  const [savedVote, setSavedVote] = useState<{ candidateId: string; salt: string } | null>(null);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    const data = loadVoteData(novelId, votingRoundId);
    if (data) {
      setSavedVote(data);
      setSelected(data.candidateId);
    }
  }, [novelId, votingRoundId]);

  if (!isConnected) {
    return (
      <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4">
        <p className="text-neutral-400 text-sm">Connect your wallet to vote.</p>
      </div>
    );
  }

  function handleCommit() {
    if (!selected) return;
    if (!votingRoundId) return;
    const salt = generateSalt();
    const commitHash = keccak256(encodePacked(["uint256", "bytes32"], [BigInt(selected), salt]));

    writeContract({
      address: VOTING_ENGINE_ADDRESS,
      abi: votingEngineAbi,
      functionName: "commitVote",
      args: [BigInt(novelId), BigInt(votingRoundId), commitHash],
      value: parseEther(stakeAmount),
    });

    saveVoteData(novelId, votingRoundId, selected, salt);
    setSavedVote({ candidateId: selected, salt });
  }

  function handleReveal() {
    if (!savedVote) return;
    writeContract({
      address: VOTING_ENGINE_ADDRESS,
      abi: votingEngineAbi,
      functionName: "revealVote",
      args: [BigInt(novelId), BigInt(votingRoundId), BigInt(savedVote.candidateId), savedVote.salt as `0x${string}`],
    });
  }

  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4">
      <h3 className="font-semibold mb-3">
        {title || (phase === "committing" ? "Cast Your Vote" : "Reveal Your Vote")}
      </h3>

      {phase === "committing" && (
        <>
          <div className="space-y-2 mb-4">
            {candidates.map(c => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`w-full text-left rounded-md border p-3 text-sm transition-colors ${
                  selected === c.id
                    ? "border-amber-500 bg-amber-950/30"
                    : "border-neutral-700 bg-neutral-800 hover:border-neutral-500"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>Candidate(ID.{c.id}) by {shortenAddress(c.author)}</span>
                  <span className="text-neutral-500">{c.vote_count} votes</span>
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <div className="flex items-center gap-2">
              <label className="text-sm text-neutral-400">Stake:</label>
              <input
                type="number"
                step="0.001"
                min="0.001"
                value={stakeAmount}
                onChange={e => setStakeAmount(e.target.value)}
                className="w-24 rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm"
              />
              <span className="text-sm text-neutral-400">ETH</span>
              <Button size="sm" onClick={handleCommit} disabled={isPending || isConfirming}>
                {isPending ? "Signing..." : isConfirming ? "Confirming..." : "Commit Vote"}
              </Button>
            </div>
          )}

          {savedVote && (
            <p className="text-green-400 text-sm mt-2">
              Vote saved locally for Candidate(ID.{savedVote.candidateId}). Keep this page data safe for the reveal phase.
            </p>
          )}
        </>
      )}

      {phase === "revealing" && (
        <>
          {savedVote ? (
            <div>
              <p className="text-sm text-neutral-300 mb-3">
                You voted for <span className="text-amber-400">Candidate(ID.{savedVote.candidateId})</span>. Reveal to make your vote count.
              </p>
              <Button onClick={handleReveal} disabled={isPending || isConfirming}>
                {isPending ? "Signing..." : isConfirming ? "Confirming..." : "Reveal Vote"}
              </Button>
            </div>
          ) : (
            <p className="text-neutral-500 text-sm">
              No saved vote found for this round. You may not have voted, or your vote data was lost.
            </p>
          )}
        </>
      )}

      {isSuccess && <p className="text-green-400 text-sm mt-2">Transaction confirmed!</p>}
      {error && <p className="text-red-400 text-sm mt-2">{error.message.slice(0, 80)}</p>}
    </div>
  );
}

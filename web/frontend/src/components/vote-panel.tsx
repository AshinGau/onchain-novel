"use client";

import { useState, useEffect } from "react";
import { parseEther, keccak256, encodePacked } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { VOTING_ENGINE_ADDRESS, votingEngineAbi } from "@/lib/contracts";
import { TOKEN_SYMBOL, DEFAULT_STAKE } from "@/lib/config";
import { shortenAddress } from "@/lib/format";
import { saveVote, loadAllVotes, loadVote, toBytes32Salt } from "@/lib/vote-storage";
import { useTxAction } from "@/hooks/use-tx-action";

interface VoteCandidate {
  id: string; author: string; chapter_index: number; vote_count: string;
  is_world_line: boolean; content_text?: string | null; comment_count?: string | number;
}

interface VotePanelProps {
  novelId: string; votingRoundId: string; phase: "committing" | "revealing";
  candidates: VoteCandidate[]; title?: string;
}

function RevealForm({ novelId, votingRoundId, votedCandidateIds, localVotes, revealSecretKey, setRevealSecretKey, handleReveal, revealTx }: any) {
  const candidateId = votedCandidateIds[0];
  const savedSalt = candidateId ? localVotes[candidateId] : null;

  useEffect(() => {
    if (savedSalt && !revealSecretKey) setRevealSecretKey(savedSalt);
  }, [savedSalt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="d-flex flex-column gap-2">
      {candidateId && (
        <p className="small">You voted for <span className="text-warning fw-semibold">Candidate(ID.{candidateId})</span>. Reveal to make it count and recover your stake.</p>
      )}
      <div>
        <label className="form-label small text-body-secondary">Secret Key</label>
        <input type="text" value={revealSecretKey} onChange={(e: any) => setRevealSecretKey(e.target.value)}
          placeholder="Enter the secret key you used when voting..."
          className="form-control form-control-sm" style={{ maxWidth: 320 }} />
        <div className="form-text">Enter the exact secret key you used during commit.</div>
      </div>
      <div>
        <button className="btn btn-primary btn-sm" onClick={handleReveal} disabled={revealTx.isBusy || !revealSecretKey.trim()}>
          {revealTx.isBusy ? (revealTx.isPending ? "Signing..." : "Confirming...") : !revealSecretKey.trim() ? "Enter Secret Key" : "Reveal Vote"}
        </button>
      </div>
      {revealTx.isError && <div className="text-danger small">{revealTx.error}</div>}
    </div>
  );
}

export function VotePanel({ novelId, votingRoundId, phase, candidates, title }: VotePanelProps) {
  const { isConnected, address } = useAccount();
  const [localVotes, setLocalVotes] = useState<Record<string, string>>({});
  const [stakeAmount, setStakeAmount] = useState(DEFAULT_STAKE);
  const [secretKey, setSecretKey] = useState("");
  const [revealSecretKey, setRevealSecretKey] = useState("");
  const [justCommittedId, setJustCommittedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: onChainCommit, refetch: refetchCommit } = useReadContract({
    address: VOTING_ENGINE_ADDRESS, abi: votingEngineAbi, functionName: "getVoteCommit",
    args: address ? [BigInt(novelId), BigInt(votingRoundId), address] : undefined,
    query: { enabled: !!address },
  });

  const onChainCommitHash = (onChainCommit as any)?.commitHash as string | undefined;
  const onChainRevealed = !!(onChainCommit as any)?.revealed;
  const alreadyCommittedOnChain = !!onChainCommitHash && onChainCommitHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  useEffect(() => { setLocalVotes(loadAllVotes(novelId, votingRoundId)); }, [novelId, votingRoundId]);
  const votedCandidateIds = Object.keys(localVotes);

  const [pendingCommit, setPendingCommit] = useState<{ candidateId: string; userSalt: string } | null>(null);

  const commitTx = useTxAction({
    onSuccess: () => {
      if (pendingCommit) {
        saveVote(novelId, votingRoundId, pendingCommit.candidateId, pendingCommit.userSalt);
        setLocalVotes((prev) => ({ ...prev, [pendingCommit!.candidateId]: pendingCommit!.userSalt }));
        setJustCommittedId(pendingCommit.candidateId);
        setSelectedId(null); setPendingCommit(null); refetchCommit();
      }
    },
  });
  const revealTx = useTxAction({ onSuccess: () => refetchCommit() });

  function handleCommit(candidateId: string) {
    const userSalt = secretKey.trim();
    if (!userSalt) return;
    const bytes32 = toBytes32Salt(userSalt);
    const commitHash = keccak256(encodePacked(["uint256", "bytes32"], [BigInt(candidateId), bytes32]));
    setPendingCommit({ candidateId, userSalt });
    commitTx.writeContract({ address: VOTING_ENGINE_ADDRESS, abi: votingEngineAbi, functionName: "commitVote",
      args: [BigInt(novelId), BigInt(votingRoundId), commitHash], value: parseEther(stakeAmount) });
    setSecretKey("");
  }

  function handleReveal() {
    const candidateId = votedCandidateIds[0];
    const salt = revealSecretKey.trim();
    if (!candidateId || !salt) return;
    const bytes32 = toBytes32Salt(salt);
    revealTx.writeContract({ address: VOTING_ENGINE_ADDRESS, abi: votingEngineAbi, functionName: "revealVote",
      args: [BigInt(novelId), BigInt(votingRoundId), BigInt(candidateId), bytes32] });
  }

  const canVote = isConnected && phase === "committing" && !alreadyCommittedOnChain && !commitTx.isBusy && !justCommittedId;
  const selectedCandidate = candidates.find((c) => c.id === selectedId);

  return (
    <div className="card">
      <div className="card-body">
        <h6 className="card-title">{title || (phase === "committing" ? "Cast Your Vote" : "Reveal Your Vote")}</h6>

        {/* Candidate list */}
        <div className="list-group mb-3">
          {candidates.map((c) => {
            const isVotedLocally = votedCandidateIds.includes(c.id);
            const isSelected = selectedId === c.id;
            const commentCount = Number(c.comment_count || 0);

            return (
              <div key={c.id}
                onClick={() => { if (canVote && !isVotedLocally) setSelectedId(isSelected ? null : c.id); }}
                className={`list-group-item list-group-item-action small ${
                  isVotedLocally ? "list-group-item-success" : isSelected ? "list-group-item-warning" : ""
                } ${canVote && !isVotedLocally ? "" : "pe-none"}`}
                role="button"
              >
                <div className="d-flex justify-content-between align-items-center">
                  <div className="d-flex align-items-center gap-2">
                    <span>Candidate(ID.{c.id}) by {shortenAddress(c.author)}</span>
                    {isSelected && (
                      <a href={`/chapters/${c.id}`} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()} className="link-primary small">View full</a>
                    )}
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {isVotedLocally && <span className="text-success small"><i className="bi bi-check-lg" /> Voted</span>}
                    <span className="text-body-tertiary"><i className="bi bi-chat" /> {commentCount}</span>
                    {Number(c.vote_count) > 0 && <span className="text-body-tertiary">{c.vote_count} votes</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Commit UI */}
        {phase === "committing" && (
          <>
            {!isConnected && <div className="alert alert-warning small py-2">Connect wallet to vote</div>}

            {isConnected && alreadyCommittedOnChain && !justCommittedId && (
              <div className="alert alert-success small py-2"><i className="bi bi-check-lg" /> You have already voted this round. One vote per address per round.</div>
            )}

            {justCommittedId && localVotes[justCommittedId] && (
              <div className="alert alert-warning small">
                <p className="text-success fw-semibold mb-1"><i className="bi bi-check-lg" /> Vote committed!</p>
                <p className="mb-1 fw-semibold">Secret key (needed to reveal &amp; recover stake):</p>
                <code className="d-block bg-body-tertiary rounded p-2 mb-1 user-select-all" style={{ wordBreak: "break-all" }}>{localVotes[justCommittedId]}</code>
                <p className="text-body-tertiary mb-1">Saved in your browser. Back it up if you may clear data.</p>
                <button onClick={() => navigator.clipboard.writeText(localVotes[justCommittedId])} className="btn btn-link btn-sm p-0">Copy</button>
              </div>
            )}

            {commitTx.isBusy && <p className="text-body-secondary small">{commitTx.isPending ? "Waiting for signature..." : "Confirming on-chain..."}</p>}
            {commitTx.isError && (
              <div>
                <p className="text-danger small">{commitTx.error}</p>
                <button onClick={commitTx.reset} className="btn btn-link btn-sm p-0 text-body-secondary">Dismiss</button>
              </div>
            )}

            {canVote && (
              <div className="border-top pt-3 mt-2">
                <p className="small text-body-secondary mb-2">Select a candidate above, then vote here. One vote per address per round.</p>

                {selectedCandidate && (
                  <div className="card card-body bg-body-tertiary p-2 mb-2 small">
                    <span className="text-body-secondary fw-medium">Selected: Candidate(ID.{selectedCandidate.id})</span>
                    {selectedCandidate.content_text ? (
                      <p className="mb-0 mt-1">{selectedCandidate.content_text.length > 100 ? selectedCandidate.content_text.slice(0, 100) + "…" : selectedCandidate.content_text}</p>
                    ) : (
                      <p className="mb-0 mt-1 text-body-tertiary fst-italic">Content not yet fetched.</p>
                    )}
                  </div>
                )}

                <div className="d-flex align-items-center gap-2 mb-2">
                  <label className="form-label small mb-0 text-body-secondary">Stake:</label>
                  <div className="input-group input-group-sm" style={{ width: 160 }}>
                    <input type="number" step="0.001" min="0.001" value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value)} className="form-control" />
                    <span className="input-group-text">{TOKEN_SYMBOL}</span>
                  </div>
                </div>

                <details className="mb-2">
                  <summary className="small text-body-secondary" role="button">How voting works (commit-reveal)</summary>
                  <div className="small text-body-secondary mt-2 d-flex flex-column gap-2">
                    <div><strong>1. Stake</strong> — Deposit {TOKEN_SYMBOL} as anti-spam. Returned when you reveal.</div>
                    <div><strong>2. Secret Key</strong> — Combined with your vote to create a hidden commitment. <span className="text-warning">Remember this key.</span></div>
                    <div><strong>3. Reveal</strong> — Enter your secret key again to reveal on-chain.</div>
                    <div><strong>4. Rewards</strong> — Winners recover stake + voter reward. Unrevealed votes forfeit stake.</div>
                  </div>
                </details>

                <div className="mb-2">
                  <label className="form-label small text-body-secondary">Secret Key</label>
                  <input type="text" value={secretKey} onChange={(e) => setSecretKey(e.target.value)}
                    placeholder="Enter a secret key you can remember..."
                    className="form-control form-control-sm" style={{ maxWidth: 320 }} />
                  {secretKey.trim().length > 0 && secretKey.trim().length < 4 && (
                    <div className="form-text text-warning">Short keys are easier to brute-force.</div>
                  )}
                  <div className="form-text">You will need this exact key to reveal your vote.</div>
                </div>

                <button onClick={() => selectedId && handleCommit(selectedId)}
                  disabled={!selectedId || !secretKey.trim() || commitTx.isBusy}
                  className="btn btn-warning">
                  {commitTx.isBusy ? (commitTx.isPending ? "Signing..." : "Confirming...")
                    : !selectedId ? "Select a Candidate Above"
                    : !secretKey.trim() ? "Enter a Secret Key"
                    : `Submit Vote ID.${selectedId}`}
                </button>
              </div>
            )}
          </>
        )}

        {/* Reveal UI */}
        {phase === "revealing" && (
          <>
            {!isConnected && <div className="alert alert-warning small py-2">Connect wallet to reveal your vote</div>}
            {isConnected && onChainRevealed && <div className="alert alert-success small py-2"><i className="bi bi-check-lg" /> Vote revealed!</div>}
            {isConnected && !onChainRevealed && alreadyCommittedOnChain && (
              <RevealForm novelId={novelId} votingRoundId={votingRoundId} votedCandidateIds={votedCandidateIds}
                localVotes={localVotes} revealSecretKey={revealSecretKey} setRevealSecretKey={setRevealSecretKey}
                handleReveal={handleReveal} revealTx={revealTx} />
            )}
            {isConnected && !alreadyCommittedOnChain && <p className="text-body-tertiary small">You did not vote in this round.</p>}
          </>
        )}
      </div>
    </div>
  );
}

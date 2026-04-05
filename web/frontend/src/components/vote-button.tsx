"use client";

import { useState, useEffect } from "react";
import { parseEther, keccak256, encodePacked } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { VOTING_ENGINE_ADDRESS, votingEngineAbi } from "@/lib/contracts";
import { TOKEN_SYMBOL, DEFAULT_STAKE } from "@/lib/config";
import { saveVote, hasVotedFor, loadVote, toBytes32Salt } from "@/lib/vote-storage";
import { useTxAction } from "@/hooks/use-tx-action";

interface VoteButtonProps { novelId: string; chapterId: string; votingRoundId: string; phase: "committing" | "revealing"; }

export function VoteButton({ novelId, chapterId, votingRoundId, phase }: VoteButtonProps) {
  const { isConnected, address } = useAccount();
  const [stakeAmount, setStakeAmount] = useState(DEFAULT_STAKE);
  const [secretKey, setSecretKey] = useState("");
  const [revealSecretKey, setRevealSecretKey] = useState("");
  const [committed, setCommitted] = useState(false);
  const [pendingSalt, setPendingSalt] = useState<string | null>(null);

  const { data: onChainCommit, refetch } = useReadContract({
    address: VOTING_ENGINE_ADDRESS, abi: votingEngineAbi, functionName: "getVoteCommit",
    args: address ? [BigInt(novelId), BigInt(votingRoundId), address] : undefined,
    query: { enabled: !!address },
  });

  const onChainCommitHash = (onChainCommit as any)?.commitHash as string | undefined;
  const onChainRevealed = !!(onChainCommit as any)?.revealed;
  const alreadyCommittedOnChain = !!onChainCommitHash && onChainCommitHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
  const localVotedThis = typeof window !== "undefined" && hasVotedFor(novelId, votingRoundId, chapterId);
  const localSalt = typeof window !== "undefined" ? loadVote(novelId, votingRoundId, chapterId) : null;

  const commitTx = useTxAction({ onSuccess: () => { if (pendingSalt) { saveVote(novelId, votingRoundId, chapterId, pendingSalt); setCommitted(true); setPendingSalt(null); refetch(); } } });
  const revealTx = useTxAction({ onSuccess: () => refetch() });

  function handleCommit() {
    const userSalt = secretKey.trim(); if (!userSalt) return;
    const bytes32 = toBytes32Salt(userSalt);
    const commitHash = keccak256(encodePacked(["uint256", "bytes32"], [BigInt(chapterId), bytes32]));
    setPendingSalt(userSalt);
    commitTx.writeContract({ address: VOTING_ENGINE_ADDRESS, abi: votingEngineAbi, functionName: "commitVote",
      args: [BigInt(novelId), BigInt(votingRoundId), commitHash], value: parseEther(stakeAmount) });
  }

  useEffect(() => { if (localSalt && !revealSecretKey) setRevealSecretKey(localSalt); }, [localSalt]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleReveal() {
    const salt = revealSecretKey.trim(); if (!salt) return;
    const bytes32 = toBytes32Salt(salt);
    revealTx.writeContract({ address: VOTING_ENGINE_ADDRESS, abi: votingEngineAbi, functionName: "revealVote",
      args: [BigInt(novelId), BigInt(votingRoundId), BigInt(chapterId), bytes32] });
  }

  if (!isConnected) return <p className="small text-warning">Connect wallet to vote for this chapter</p>;

  if (phase === "committing") {
    if (alreadyCommittedOnChain) {
      if (localVotedThis) return <p className="small text-success"><i className="bi bi-check-lg" /> You voted for this chapter</p>;
      return <p className="small text-body-secondary"><i className="bi bi-check-lg" /> You already voted this round (one vote per address).</p>;
    }
    if (commitTx.isBusy) return <p className="small text-body-secondary">{commitTx.isPending ? "Waiting for signature..." : "Confirming..."}</p>;

    if (committed && localSalt) {
      return (
        <div>
          <p className="small text-success"><i className="bi bi-check-lg" /> Vote committed!</p>
          <div className="alert alert-warning small py-2">
            <p className="fw-semibold mb-1">Secret key (needed to reveal &amp; recover stake):</p>
            <code className="d-block bg-body-tertiary rounded p-2 mb-1 user-select-all" style={{ wordBreak: "break-all" }}>{localSalt}</code>
            <p className="text-body-tertiary mb-1">Saved in your browser.</p>
            <button onClick={() => navigator.clipboard.writeText(localSalt)} className="btn btn-link btn-sm p-0">Copy</button>
          </div>
        </div>
      );
    }

    if (commitTx.isError) {
      return (
        <div>
          <p className="small text-danger">{commitTx.error}</p>
          <button className="btn btn-outline-secondary btn-sm" onClick={commitTx.reset}>Try again</button>
        </div>
      );
    }

    return (
      <div className="d-flex flex-column gap-2">
        <div className="d-flex align-items-center gap-2">
          <label className="form-label small mb-0 text-body-secondary">Stake:</label>
          <div className="input-group input-group-sm" style={{ width: 160 }}>
            <input type="number" step="0.001" min="0.001" value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)} className="form-control" />
            <span className="input-group-text">{TOKEN_SYMBOL}</span>
          </div>
        </div>
        <div>
          <label className="form-label small text-body-secondary">Secret Key</label>
          <input type="text" value={secretKey} onChange={(e) => setSecretKey(e.target.value)}
            placeholder="Enter a secret key you can remember..."
            className="form-control form-control-sm" style={{ maxWidth: 300 }} />
          {secretKey.trim().length > 0 && secretKey.trim().length < 4 && (
            <div className="form-text text-warning">Short keys are easier to brute-force.</div>
          )}
          <div className="form-text">You will need this exact key to reveal your vote.</div>
        </div>
        <div>
          <button className="btn btn-primary btn-sm" onClick={handleCommit} disabled={!secretKey.trim()}>
            {secretKey.trim() ? "Vote for this" : "Enter a Secret Key"}
          </button>
        </div>
      </div>
    );
  }

  // Revealing phase
  if (revealTx.isSuccess || onChainRevealed) return <p className="small text-success"><i className="bi bi-check-lg" /> Vote revealed!</p>;
  if (!alreadyCommittedOnChain) return <p className="small text-body-tertiary">You did not vote in this round.</p>;
  if (!localVotedThis) return <p className="small text-body-tertiary">You voted this round but not for this chapter.</p>;

  return (
    <div className="d-flex flex-column gap-2">
      <div>
        <label className="form-label small text-body-secondary">Secret Key</label>
        <input type="text" value={revealSecretKey} onChange={(e) => setRevealSecretKey(e.target.value)}
          placeholder="Enter the secret key you used when voting..."
          className="form-control form-control-sm" style={{ maxWidth: 320 }} />
        <div className="form-text">Enter the exact secret key you used during commit.</div>
      </div>
      <div>
        <button className="btn btn-primary btn-sm" onClick={handleReveal} disabled={revealTx.isBusy || !revealSecretKey.trim()}>
          {revealTx.isBusy ? (revealTx.isPending ? "Signing..." : "Confirming...") : !revealSecretKey.trim() ? "Enter Secret Key" : "Reveal vote"}
        </button>
      </div>
      <p className="small text-body-tertiary">Reveal to make your vote count and recover your stake.</p>
      {revealTx.isError && <p className="small text-danger">{revealTx.error}</p>}
    </div>
  );
}

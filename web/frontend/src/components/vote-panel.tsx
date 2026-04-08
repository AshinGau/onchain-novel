"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useTxAction } from "@/hooks/use-tx-action";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import {
  saveVote,
  loadVote,
  clearVote,
  toBytes32Salt,
  computeCommitHash,
} from "@/lib/vote-storage";

interface VotePanelProps {
  novelId: string;
  round: number;
  /** Current phase: 2=Committing, 3=Revealing */
  phase: number;
  candidateId: string;
  voteStake: string;
}

export function VotePanel({
  novelId,
  round,
  phase,
  candidateId,
  voteStake,
}: VotePanelProps) {
  const { isConnected } = useAccount();
  const [saltInput, setSaltInput] = useState("");
  const { send, status, error, isPending, reset } = useTxAction();
  const [storedVote, setStoredVote] = useState(loadVote(novelId, round));

  useEffect(() => {
    setStoredVote(loadVote(novelId, round));
  }, [novelId, round]);

  if (!isConnected) {
    return (
      <div className="on-card on-stack" style={{ gap: "0.5rem", alignItems: "center" }}>
        <p className="text-caption">Connect wallet to vote</p>
        <ConnectButton />
      </div>
    );
  }

  // Committing phase
  if (phase === 2) {
    async function handleCommit() {
      const salt = toBytes32Salt(saltInput);
      const commitHash = computeCommitHash(BigInt(candidateId), salt);

      await send(
        {
          address: NOVEL_CORE_ADDRESS,
          abi: novelCoreAbi,
          functionName: "commitVote",
          args: [BigInt(novelId), commitHash],
          value: BigInt(voteStake),
        },
        () => {
          saveVote(novelId, round, candidateId, saltInput);
          setStoredVote({ candidateId, salt: saltInput });
        }
      );
    }

    if (storedVote) {
      return (
        <div className="on-card on-stack" style={{ gap: "0.5rem" }}>
          <p style={{ color: "var(--color-success)", margin: 0, fontSize: "0.875rem" }}>
            Vote committed for Ch.{storedVote.candidateId}. Wait for reveal phase.
          </p>
        </div>
      );
    }

    return (
      <div className="on-card on-stack" style={{ gap: "0.75rem" }}>
        <h4 className="text-subheading" style={{ margin: 0 }}>
          Vote for Ch.{candidateId}
        </h4>
        <div className="on-stack" style={{ gap: "0.5rem" }}>
          <label className="text-caption">Salt (remember this for reveal):</label>
          <input
            type="text"
            value={saltInput}
            onChange={(e) => setSaltInput(e.target.value)}
            placeholder="Enter a secret salt..."
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "0.5rem",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-secondary)",
              color: "var(--color-text)",
              fontSize: "0.875rem",
            }}
          />
          <span className="text-caption text-muted">
            Stake: {voteStake} wei
          </span>
        </div>
        <button
          className="on-btn on-btn-primary"
          onClick={handleCommit}
          disabled={!saltInput.trim() || isPending}
          style={{ opacity: !saltInput.trim() || isPending ? 0.5 : 1 }}
        >
          {isPending ? "Committing..." : "Commit Vote"}
        </button>
        {error && (
          <p style={{ color: "var(--color-danger)", margin: 0, fontSize: "0.875rem" }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  // Revealing phase
  if (phase === 3) {
    async function handleReveal() {
      if (!storedVote) return;
      const salt = toBytes32Salt(storedVote.salt);

      await send(
        {
          address: NOVEL_CORE_ADDRESS,
          abi: novelCoreAbi,
          functionName: "revealVote",
          args: [BigInt(novelId), BigInt(storedVote.candidateId), salt],
        },
        () => {
          clearVote(novelId, round);
          setStoredVote(null);
        }
      );
    }

    if (!storedVote) {
      return (
        <div className="on-card on-stack" style={{ gap: "0.5rem" }}>
          <p className="text-caption text-muted">
            No saved vote found for this round. You may have already revealed or not committed.
          </p>
        </div>
      );
    }

    return (
      <div className="on-card on-stack" style={{ gap: "0.75rem" }}>
        <h4 className="text-subheading" style={{ margin: 0 }}>
          Reveal Vote
        </h4>
        <p className="text-caption">
          Candidate: Ch.{storedVote.candidateId} | Salt: {storedVote.salt}
        </p>
        <button
          className="on-btn on-btn-primary"
          onClick={handleReveal}
          disabled={isPending}
          style={{ opacity: isPending ? 0.5 : 1 }}
        >
          {isPending ? "Revealing..." : "Reveal Vote"}
        </button>
        {status === "success" && (
          <p style={{ color: "var(--color-success)", margin: 0, fontSize: "0.875rem" }}>
            Vote revealed! Wait for settlement.
          </p>
        )}
        {error && (
          <p style={{ color: "var(--color-danger)", margin: 0, fontSize: "0.875rem" }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return null;
}

"use client";

/**
 * Vote panel for the chapter page.
 *
 * Per docs/frontend.md §8:
 *   - Auto-generates a 32-byte salt (the user never sees it).
 *   - Computes commitHash = keccak256(abi.encodePacked(uint64(candidateId), bytes32(salt))).
 *   - Sends commitVote on-chain with voteStake.
 *   - On success: signs canonical message and POSTs plaintext (candidateId, salt) to
 *     /api/votes/submit so the backend keeper can auto-reveal during the reveal phase.
 *   - Salt is also persisted to localStorage as a fallback for manual reveal.
 *
 * Per docs/frontend.md §10: Nominating UI is not exposed here (CLI/MCP only).
 */

import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useTxAction } from "@/hooks/use-tx-action";
import { NOVEL_CORE_ADDRESS, novelCoreAbi } from "@/lib/contracts";
import {
  saveVote,
  loadVote,
  clearVote,
  generateSalt,
  computeCommitHash,
  type StoredVote,
} from "@/lib/vote-storage";
import { submitVotePlaintext } from "@/lib/api";

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
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { send, error, isPending } = useTxAction();
  const [storedVote, setStoredVote] = useState<StoredVote | null>(null);
  const [submitNote, setSubmitNote] = useState<string | null>(null);

  // Hydrate stored vote on the client only (avoid SSR/CSR mismatch)
  useEffect(() => {
    setStoredVote(loadVote(novelId, round));
  }, [novelId, round]);

  if (!isConnected || !address) {
    return (
      <div className="on-card">
        <p className="text-caption">Connect wallet to vote</p>
        <ConnectButton />
      </div>
    );
  }

  // ── Committing phase ──
  if (phase === 2) {
    if (storedVote) {
      return (
        <div className="on-card">
          <p className="text-success">
            Vote committed for ID.{storedVote.candidateId}.{" "}
            {storedVote.keeperSubmitted
              ? "Keeper will auto-reveal."
              : "You will need to reveal manually during the reveal phase."}
          </p>
        </div>
      );
    }

    async function handleCommit() {
      setSubmitNote(null);
      const salt = generateSalt();
      const commitHash = computeCommitHash(BigInt(candidateId), salt);

      await send(
        {
          address: NOVEL_CORE_ADDRESS,
          abi: novelCoreAbi,
          functionName: "commitVote",
          args: [BigInt(novelId), commitHash],
          value: BigInt(voteStake),
        },
        async () => {
          // After on-chain commit succeeds, attempt keeper-assisted reveal submission.
          // Failure here is non-fatal: the salt is still saved locally for manual reveal.
          let keeperSubmitted = false;
          try {
            const ts = Math.floor(Date.now() / 1000);
            const message =
              `Submit vote on novel ${novelId} round ${round} for candidate ${candidateId} at ${ts}`;
            const signature = await signMessageAsync({ message });
            const result = await submitVotePlaintext({
              address: address!,
              novelId: Number(novelId),
              round,
              candidateId: Number(candidateId),
              salt,
              timestamp: ts,
              signature,
            });
            keeperSubmitted = result.ok;
            if (!result.ok) {
              setSubmitNote(
                result.status === 503
                  ? "Keeper-assisted reveal disabled. You will need to reveal manually."
                  : `Keeper submission failed (${result.status}). You will need to reveal manually.`,
              );
            }
          } catch {
            setSubmitNote("Could not submit to keeper. You will need to reveal manually.");
          }

          saveVote(novelId, round, candidateId, salt, keeperSubmitted);
          setStoredVote({ candidateId, salt, keeperSubmitted });
        },
      );
    }

    return (
      <div className="on-card">
        <h4 className="text-subheading">Vote for ID.{candidateId}</h4>
        <p className="text-caption">Stake: {voteStake} wei</p>
        <button
          type="button"
          className="on-btn on-btn-primary"
          onClick={handleCommit}
          disabled={isPending}
        >
          {isPending ? "Committing…" : "Commit vote"}
        </button>
        {submitNote && <p className="text-caption text-muted">{submitNote}</p>}
        {error && <p className="text-danger">{error}</p>}
      </div>
    );
  }

  // ── Revealing phase ──
  if (phase === 3) {
    if (!storedVote) {
      return (
        <div className="on-card">
          <p className="text-muted">
            No saved vote found for this round. You may have already revealed or did not commit.
          </p>
        </div>
      );
    }

    if (storedVote.keeperSubmitted) {
      return (
        <div className="on-card">
          <p className="text-success">
            Vote committed for ID.{storedVote.candidateId}. The keeper will reveal it
            automatically; manual reveal is only needed if the keeper fails.
          </p>
          <ManualRevealButton
            novelId={novelId}
            stored={storedVote}
            onRevealed={() => {
              clearVote(novelId, round);
              setStoredVote(null);
            }}
          />
        </div>
      );
    }

    return (
      <div className="on-card">
        <h4 className="text-subheading">Reveal vote</h4>
        <p className="text-caption">Candidate: ID.{storedVote.candidateId}</p>
        <ManualRevealButton
          novelId={novelId}
          stored={storedVote}
          onRevealed={() => {
            clearVote(novelId, round);
            setStoredVote(null);
          }}
        />
      </div>
    );
  }

  return null;
}

function ManualRevealButton({
  novelId,
  stored,
  onRevealed,
}: {
  novelId: string;
  stored: StoredVote;
  onRevealed: () => void;
}) {
  const { send, error, isPending, status } = useTxAction();

  async function handleReveal() {
    await send(
      {
        address: NOVEL_CORE_ADDRESS,
        abi: novelCoreAbi,
        functionName: "revealVote",
        args: [BigInt(novelId), BigInt(stored.candidateId), stored.salt],
      },
      onRevealed,
    );
  }

  return (
    <div className="on-stack on-stack-sm">
      <button
        type="button"
        className="on-btn on-btn-secondary"
        onClick={handleReveal}
        disabled={isPending}
      >
        {isPending ? "Revealing…" : "Reveal manually"}
      </button>
      {status === "success" && <p className="text-success">Vote revealed.</p>}
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}

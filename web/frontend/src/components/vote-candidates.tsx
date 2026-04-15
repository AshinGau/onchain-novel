"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

import { txButtonLabel, TxStatusLabel } from "@/components/tx-status";
import { useNicknames } from "@/hooks/use-nickname";
import { useTxAction } from "@/hooks/use-tx-action";
import type { ChapterSummary, RoundCandidate } from "@/lib/api";
import { submitVotePlaintext } from "@/lib/api";
import { ROUND_MANAGER_ADDRESS, roundManagerAbi } from "@/lib/contracts";
import { formatEth, timeAgo } from "@/lib/format";
import {
  clearVote,
  computeCommitHash,
  generateSalt,
  loadVote,
  saveVote,
  type StoredVote,
} from "@/lib/vote-storage";

interface Props {
  novelId: string;
  round: number;
  /** Contract phase: 1=Nominating, 2=Committing(Voting), 3=Revealing */
  phase: number;
  voteStake: string;
  candidates: RoundCandidate[];
  chapters: ChapterSummary[];
}

function resolvePath(
  candidateId: string,
  byId: Map<string, ChapterSummary>,
): { ancestorId: string | null; hops: number } {
  const start = byId.get(candidateId);
  if (!start) return { ancestorId: null, hops: 0 };
  if (start.is_world_line) return { ancestorId: candidateId, hops: 0 };

  let hops = 0;
  let current: ChapterSummary | undefined = start;
  while (current && current.parent_id && current.parent_id !== "0") {
    const parent = byId.get(current.parent_id);
    if (!parent) break;
    if (parent.is_world_line) return { ancestorId: parent.id, hops };
    hops++;
    current = parent;
  }
  return { ancestorId: null, hops };
}

export function VoteCandidates({ novelId, round, phase, voteStake, candidates, chapters }: Props) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { send, status, error, reset } = useTxAction();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredVote | null>(null);
  const [submitNote, setSubmitNote] = useState<string | null>(null);
  const [rescueSalt, setRescueSalt] = useState<StoredVote | null>(null);

  useEffect(() => {
    setStored(loadVote(novelId, round));
  }, [novelId, round]);

  const authors = candidates.map((c) => c.author);
  const displayName = useNicknames(authors);
  const byId = useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters]);

  if (candidates.length === 0) return null;

  const phaseHint =
    phase === 1
      ? "Nomination is open — additional candidates may be added."
      : phase === 2
        ? "Voting is open. Select a candidate below, then click Vote."
        : "Revealing phase — votes are being revealed.";

  const committing = phase === 2;
  const revealing = phase === 3;
  const alreadyVoted = !!stored;

  async function handleCommit() {
    if (!selectedId || !address) return;
    setSubmitNote(null);
    const salt = generateSalt();
    const commitHash = computeCommitHash(address, BigInt(selectedId), salt);

    await send(
      {
        address: ROUND_MANAGER_ADDRESS,
        abi: roundManagerAbi,
        functionName: "commitVote",
        args: [BigInt(novelId), commitHash],
        value: BigInt(voteStake),
      },
      async () => {
        let keeperSubmitted = false;
        try {
          const ts = Math.floor(Date.now() / 1000);
          const message = `Submit vote on novel ${novelId} round ${round} for candidate ${selectedId} at ${ts}`;
          const signature = await signMessageAsync({ message });
          const result = await submitVotePlaintext({
            address: address!,
            novelId: Number(novelId),
            round,
            candidateId: Number(selectedId),
            salt,
            timestamp: ts,
            signature,
          });
          keeperSubmitted = result.ok;
          if (!result.ok) {
            setSubmitNote(
              result.status === 503
                ? "Keeper-assisted reveal is disabled. Save the salt below for manual reveal."
                : `Keeper submission failed (${result.status}). Save the salt below for manual reveal.`,
            );
          }
        } catch {
          setSubmitNote("Could not submit to keeper. Save the salt below for manual reveal.");
        }

        saveVote(novelId, round, selectedId!, salt, keeperSubmitted);
        const newStored = { candidateId: selectedId!, salt, keeperSubmitted };
        setStored(newStored);
        if (!keeperSubmitted) setRescueSalt(newStored);
      },
    );
  }

  return (
    <div className="on-card on-stack" style={{ gap: "0.5rem" }}>
      <div className="on-row-between">
        <h3 className="text-subheading" style={{ margin: 0 }}>
          Candidates ({candidates.length})
        </h3>
        <span className="text-tiny text-muted">{phaseHint}</span>
      </div>

      <div className="on-stack" style={{ gap: "0.375rem" }}>
        {candidates.map((cand) => {
          const { ancestorId, hops } = resolvePath(cand.chapter_id, byId);
          const midLabel =
            hops === 0 ? "→ 0 chapters →" : hops === 1 ? "→ 1 chapter →" : `→ ${hops} chapters →`;
          const isSelected = selectedId === cand.chapter_id;
          const isMyVote = stored?.candidateId === cand.chapter_id;
          const selectable = committing && !alreadyVoted;

          const border = isMyVote
            ? "2px solid var(--color-success)"
            : isSelected
              ? "2px solid var(--color-primary)"
              : "1px solid var(--color-border)";

          return (
            <div
              key={cand.chapter_id}
              onClick={selectable ? () => setSelectedId(cand.chapter_id) : undefined}
              className="on-card-hover"
              style={{
                padding: "0.5rem 0.75rem",
                borderRadius: "0.5rem",
                border,
                background: "var(--color-bg)",
                cursor: selectable ? "pointer" : "default",
              }}
            >
              <div className="on-row-wrap" style={{ gap: "0.5rem", alignItems: "center" }}>
                {ancestorId ? (
                  <>
                    <span className="on-badge badge-worldline">ID.{ancestorId}</span>
                    <span className="text-muted" style={{ fontSize: "0.8125rem" }}>
                      {midLabel}
                    </span>
                  </>
                ) : (
                  <span className="text-muted" style={{ fontSize: "0.8125rem" }}>
                    (root →)
                  </span>
                )}
                <Link
                  href={`/novels/${novelId}/chapter/${cand.chapter_id}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ fontWeight: 600, textDecoration: "none", color: "inherit" }}
                  className="text-link"
                >
                  ID.{cand.chapter_id}
                </Link>
                <span className="text-muted" style={{ fontSize: "0.8125rem" }}>
                  by {displayName(cand.author)} · {timeAgo(cand.timestamp)}
                </span>
                {isMyVote && (
                  <span className="on-badge badge-completed" style={{ marginLeft: "auto" }}>
                    Your Vote
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Action area */}
      {committing && (
        <div className="on-stack" style={{ gap: "0.5rem", marginTop: "0.5rem" }}>
          {!isConnected ? (
            <div className="on-row">
              <ConnectButton />
            </div>
          ) : alreadyVoted ? (
            <p className="text-success" style={{ margin: 0 }}>
              ✓ You voted ID.{stored!.candidateId} this round.{" "}
              {stored!.keeperSubmitted
                ? "Keeper will auto-reveal."
                : "Reveal manually in the reveal phase."}
            </p>
          ) : (
            <>
              <div className="on-row-wrap" style={{ gap: "0.5rem", alignItems: "center" }}>
                <button
                  type="button"
                  className="on-btn on-btn-primary"
                  disabled={!selectedId || status === "confirming" || status === "waiting"}
                  onClick={handleCommit}
                >
                  {selectedId
                    ? txButtonLabel(status, `Vote ID.${selectedId} (${formatEth(voteStake)})`)
                    : "Select a candidate"}
                </button>
                <TxStatusLabel status={status} error={error} successText="Vote committed!" />
                {status === "error" && (
                  <button type="button" className="on-btn on-btn-ghost" onClick={reset}>
                    Retry
                  </button>
                )}
              </div>
              <p className="text-tiny text-muted" style={{ margin: 0 }}>
                Voting requires <strong>two signatures</strong>: (1) the commit transaction on-chain
                with your stake, (2) an off-chain auth signature so the keeper can auto-reveal
                during the reveal phase. If the keeper is unavailable, you'll receive your salt to
                reveal manually.
              </p>
              {submitNote && (
                <p className="text-caption text-muted" style={{ margin: 0 }}>
                  {submitNote}
                </p>
              )}
            </>
          )}

          {rescueSalt && (
            <div
              className="on-card"
              style={{
                borderColor: "var(--color-warning)",
                background: "color-mix(in srgb, var(--color-warning) 8%, transparent)",
              }}
            >
              <p
                className="text-caption"
                style={{ margin: 0, fontWeight: 600, color: "var(--color-warning)" }}
              >
                ⚠ Keeper did not accept your vote. Save these values so you can reveal manually
                during the reveal phase:
              </p>
              <pre
                className="on-table-mono"
                style={{
                  margin: "0.5rem 0",
                  padding: "0.5rem",
                  background: "var(--color-bg-secondary)",
                  borderRadius: "0.375rem",
                  fontSize: "0.75rem",
                  overflowX: "auto",
                }}
              >
                {`novel:     ${novelId}
round:     ${round}
candidate: ${rescueSalt.candidateId}
salt:      ${rescueSalt.salt}`}
              </pre>
              <button
                type="button"
                className="on-btn-soft"
                onClick={() => {
                  navigator.clipboard.writeText(
                    `novel=${novelId} round=${round} candidate=${rescueSalt.candidateId} salt=${rescueSalt.salt}`,
                  );
                }}
              >
                Copy rescue params
              </button>
            </div>
          )}
        </div>
      )}

      {revealing && stored && address && (
        <RevealAction
          novelId={novelId}
          round={round}
          voter={address}
          stored={stored}
          onRevealed={() => {
            clearVote(novelId, round);
            setStored(null);
          }}
        />
      )}
      {revealing && !stored && (
        <p className="text-muted text-caption" style={{ margin: 0 }}>
          No saved vote found for this round on this device.
        </p>
      )}
    </div>
  );
}

function RevealAction({
  novelId,
  round,
  voter,
  stored,
  onRevealed,
}: {
  novelId: string;
  round: number;
  voter: `0x${string}`;
  stored: StoredVote;
  onRevealed: () => void;
}) {
  const { send, status, error } = useTxAction();

  async function handleReveal() {
    await send(
      {
        address: ROUND_MANAGER_ADDRESS,
        abi: roundManagerAbi,
        functionName: "revealVote",
        args: [BigInt(novelId), voter, BigInt(stored.candidateId), stored.salt],
      },
      onRevealed,
    );
  }

  return (
    <div className="on-stack" style={{ gap: "0.5rem", marginTop: "0.5rem" }}>
      {stored.keeperSubmitted ? (
        <p className="text-success" style={{ margin: 0 }}>
          ✓ Committed ID.{stored.candidateId}. Keeper will reveal automatically.
        </p>
      ) : (
        <p className="text-warning" style={{ margin: 0 }}>
          Your vote was not submitted to the keeper. Reveal manually below before the reveal phase
          ends.
        </p>
      )}
      <div className="on-row" style={{ gap: "0.5rem", alignItems: "center" }}>
        <button
          type="button"
          className="on-btn on-btn-secondary"
          onClick={handleReveal}
          disabled={status === "confirming" || status === "waiting"}
        >
          {txButtonLabel(status, "Reveal manually")}
        </button>
        <TxStatusLabel status={status} error={error} successText="Vote revealed!" />
      </div>
    </div>
  );
}

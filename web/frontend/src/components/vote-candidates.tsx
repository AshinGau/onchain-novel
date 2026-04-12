"use client";

import Link from "next/link";
import type { ChapterSummary, RoundCandidate } from "@/lib/api";
import { useNicknames } from "@/hooks/use-nickname";
import { timeAgo } from "@/lib/format";

interface Props {
  novelId: string;
  candidates: RoundCandidate[];
  chapters: ChapterSummary[];
  /** Contract phase: 1=Nominating, 2=Committing(Voting), 3=Revealing */
  phase: number;
}

/**
 * For each candidate chapter, walk up parent_id until we find a chapter
 * with is_world_line=TRUE. That's the world line ancestor for this round.
 * Returns { ancestor, hops } — hops = number of chapters between ancestor and leaf
 * (not counting ancestor itself, not counting leaf).
 */
function resolvePath(
  candidateId: string,
  byId: Map<string, ChapterSummary>,
): { ancestorId: string | null; hops: number } {
  // If the candidate itself is a world line (edge case: ancestor had no descendant,
  // but the new N >= N contract prevents this — keep it defensive).
  const start = byId.get(candidateId);
  if (!start) return { ancestorId: null, hops: 0 };
  if (start.is_world_line) return { ancestorId: candidateId, hops: 0 };

  let hops = 0;
  let current: ChapterSummary | undefined = start;
  while (current && current.parent_id && current.parent_id !== "0") {
    const parent = byId.get(current.parent_id);
    if (!parent) break;
    if (parent.is_world_line) {
      return { ancestorId: parent.id, hops };
    }
    hops++;
    current = parent;
  }
  return { ancestorId: null, hops };
}

export function VoteCandidates({ novelId, candidates, chapters, phase }: Props) {
  const authors = candidates.map((c) => c.author);
  const displayName = useNicknames(authors);

  if (candidates.length === 0) return null;

  const byId = new Map(chapters.map((c) => [c.id, c]));

  const phaseHint =
    phase === 1
      ? "Nomination is open — additional candidates may be added."
      : phase === 2
        ? "Voting is open. Click a candidate to cast your vote."
        : "Revealing phase — votes are being revealed.";

  return (
    <div className="on-card on-stack" style={{ gap: "0.5rem" }}>
      <div className="on-row-between">
        <h3 className="text-subheading" style={{ margin: 0 }}>Candidates ({candidates.length})</h3>
        <span className="text-tiny text-muted">{phaseHint}</span>
      </div>

      <div className="on-stack" style={{ gap: "0.375rem" }}>
        {candidates.map((cand) => {
          const { ancestorId, hops } = resolvePath(cand.chapter_id, byId);
          const midLabel =
            hops === 0
              ? "→ 0 chapters →"
              : hops === 1
                ? "→ 1 chapter →"
                : `→ ${hops} chapters →`;

          return (
            <Link
              key={cand.chapter_id}
              href={`/novels/${novelId}/chapter/${cand.chapter_id}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div className="on-card-hover" style={{
                padding: "0.5rem 0.75rem", borderRadius: "0.5rem",
                border: "1px solid var(--color-border)", background: "var(--color-bg)",
              }}>
                <div className="on-row-wrap" style={{ gap: "0.5rem", alignItems: "center" }}>
                  {ancestorId ? (
                    <>
                      <span className="on-badge badge-worldline">ID.{ancestorId}</span>
                      <span className="text-muted" style={{ fontSize: "0.8125rem" }}>{midLabel}</span>
                    </>
                  ) : (
                    <span className="text-muted" style={{ fontSize: "0.8125rem" }}>(root →)</span>
                  )}
                  <span style={{ fontWeight: 600 }}>ID.{cand.chapter_id}</span>
                  <span className="text-muted" style={{ fontSize: "0.8125rem" }}>
                    by {displayName(cand.author)} · {timeAgo(cand.timestamp)}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

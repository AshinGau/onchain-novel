"use client";

import { useState, useEffect } from "react";
import { hasVotedFor } from "@/lib/vote-storage";

interface VotedBadgeProps {
  novelId: string;
  votingRoundId: string;
  chapterId: string;
}

export function VotedBadge({ novelId, votingRoundId, chapterId }: VotedBadgeProps) {
  const [voted, setVoted] = useState(false);

  useEffect(() => {
    setVoted(hasVotedFor(novelId, votingRoundId, chapterId));
  }, [novelId, votingRoundId, chapterId]);

  if (!voted) return null;

  return <span className="badge bg-success" title="You voted for this"><i className="bi bi-check" /></span>;
}

"use client";

import { useState } from "react";

import type { ChapterSummary } from "@/lib/api";

import { ChapterCardMini } from "./chapter-card-mini";

interface CollapsedChaptersProps {
  chapters: ChapterSummary[];
  novelId: string;
  label?: string;
}

export function CollapsedChapters({ chapters, novelId, label }: CollapsedChaptersProps) {
  const [expanded, setExpanded] = useState(false);

  if (chapters.length === 0) return null;

  if (!expanded) {
    return (
      <div
        className="collapsed-chapters"
        onClick={() => setExpanded(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") setExpanded(true);
        }}
      >
        {label ?? `... ${chapters.length} chapter${chapters.length !== 1 ? "s" : ""} ...`}
      </div>
    );
  }

  return (
    <div className="on-stack" style={{ gap: "0.375rem" }}>
      <div
        className="collapsed-chapters"
        onClick={() => setExpanded(false)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") setExpanded(false);
        }}
      >
        Collapse
      </div>
      {chapters.map((ch) => (
        <ChapterCardMini key={ch.id} chapter={ch} novelId={novelId} />
      ))}
    </div>
  );
}

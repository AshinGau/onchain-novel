"use client";

import type { ChapterSummary } from "@/lib/api";
import { StoryTree } from "@/components/story-tree";

interface TreePageClientProps {
  novelId: string;
  chapters: ChapterSummary[];
}

export function TreePageClient({ novelId, chapters }: TreePageClientProps) {
  if (chapters.length === 0) {
    return (
      <div className="text-caption" style={{ textAlign: "center", padding: "3rem 0" }}>
        No chapters to display in the tree.
      </div>
    );
  }

  return (
    <div
      className="on-card"
      style={{ padding: 0, overflow: "hidden", minHeight: "600px" }}
    >
      <StoryTree chapters={chapters} novelId={novelId} />
    </div>
  );
}

"use client";

import { ChapterReader } from "@/components/chapter-reader";
import type { ChapterContext } from "@/lib/api";

interface ReadPageClientProps {
  chapters: ChapterContext[];
  novelId: string;
  novelTitle: string;
  leafId: string;
  initialDepthParam?: number;
}

export function ReadPageClient({
  chapters,
  novelId,
  novelTitle,
  leafId,
  initialDepthParam,
}: ReadPageClientProps) {
  if (chapters.length === 0) {
    return (
      <div className="text-caption" style={{ textAlign: "center", padding: "3rem 0" }}>
        No chapters found in this storyline.
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-heading" style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        {novelTitle || "Untitled Novel"}
      </h1>
      <ChapterReader
        chapters={chapters}
        novelId={novelId}
        novelTitle={novelTitle}
        leafId={leafId}
        initialDepthParam={initialDepthParam}
      />
    </div>
  );
}

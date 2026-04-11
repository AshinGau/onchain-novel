"use client";

import { useState } from "react";
import type { ChapterSummary } from "@/lib/api";
import { fetchNovelTree } from "@/lib/api";
import { StoryTree } from "@/components/story-tree";

interface TreePageClientProps {
  novelId: string;
  initialChapters: ChapterSummary[];
  initialHasMore: boolean;
  initialMaxDepth: number;
  depthPageSize: number;
}

export function TreePageClient({
  novelId,
  initialChapters,
  initialHasMore,
  initialMaxDepth,
  depthPageSize,
}: TreePageClientProps) {
  const [chapters, setChapters] = useState(initialChapters);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [maxDepth, setMaxDepth] = useState(initialMaxDepth);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    setLoading(true);
    try {
      const nextDepth = maxDepth + depthPageSize;
      const data = await fetchNovelTree(novelId, nextDepth);
      setChapters(data.chapters);
      setHasMore(data.hasMore);
      setMaxDepth(data.maxDepth);
    } finally {
      setLoading(false);
    }
  }

  if (chapters.length === 0) {
    return (
      <div className="text-caption on-text-center" style={{ padding: "3rem 0" }}>
        No chapters to display in the tree.
      </div>
    );
  }

  return (
    <div className="on-card" style={{ padding: 0, overflow: "hidden" }}>
      <StoryTree
        chapters={chapters}
        novelId={novelId}
        hasMore={hasMore}
        maxDepth={maxDepth}
        loading={loading}
        onLoadMore={loadMore}
      />
    </div>
  );
}

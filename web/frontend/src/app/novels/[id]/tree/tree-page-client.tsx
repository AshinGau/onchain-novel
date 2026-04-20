"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { StoryTree } from "@/components/story-tree";
import type { ChapterSummary } from "@/lib/api";
import { fetchNovelTree } from "@/lib/api";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [chapters, setChapters] = useState(initialChapters);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [maxDepth, setMaxDepth] = useState(initialMaxDepth);
  const [loading, setLoading] = useState(false);

  const fromId = searchParams.get("from");
  const toId = searchParams.get("to");

  // Sync highlighted storyline to the URL (?from=&to=). The URL is the single
  // source of truth for which path is lit up; props re-feed into <StoryTree/>.
  const setHighlightPath = useCallback(
    (from: string | null, to: string | null) => {
      const base = `/novels/${novelId}/tree`;
      if (from && to) {
        const q = new URLSearchParams({ from, to }).toString();
        router.replace(`${base}?${q}`, { scroll: false });
      } else {
        router.replace(base, { scroll: false });
      }
    },
    [novelId, router],
  );

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
        highlightFromId={fromId}
        highlightToId={toId}
        onHighlightPath={setHighlightPath}
      />
    </div>
  );
}

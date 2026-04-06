"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { StoryTree } from "@/components/story-tree";
import { API_BASE, type TreeChapter } from "@/lib/api";

interface EpochData {
  chapters: TreeChapter[];
  anchors: TreeChapter[];
}

export function ConnectedStoryTree({ initialChapters, initialAnchors, currentEpoch, novelId, votingRoundId, continuable, activeWorldLineIds, forkSourceNovelId, forkSourceChapterId }: {
  initialChapters: TreeChapter[];
  initialAnchors?: TreeChapter[];
  currentEpoch: number;
  novelId: string;
  votingRoundId?: string;
  continuable?: boolean;
  activeWorldLineIds?: Set<string>;
  forkSourceNovelId?: string | null;
  forkSourceChapterId?: string | null;
}) {
  const { address } = useAccount();

  // Map of epoch -> loaded data. Current epoch is pre-populated.
  const displayEpoch = currentEpoch <= 0 ? 1 : currentEpoch;
  const [epochData, setEpochData] = useState<Map<number, EpochData>>(() => {
    const m = new Map<number, EpochData>();
    m.set(displayEpoch, { chapters: initialChapters, anchors: initialAnchors || [] });
    return m;
  });
  const [loadingEpochs, setLoadingEpochs] = useState<Set<number>>(new Set());

  const loadEpoch = useCallback(async (epoch: number) => {
    if (epochData.has(epoch) || loadingEpochs.has(epoch)) return;
    setLoadingEpochs(prev => new Set(prev).add(epoch));
    try {
      const res = await fetch(`${API_BASE}/api/novels/${novelId}/tree?epoch=${epoch}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data: { chapters: TreeChapter[]; anchors: TreeChapter[] } = await res.json();
      setEpochData(prev => {
        const next = new Map(prev);
        next.set(epoch, { chapters: data.chapters, anchors: data.anchors || [] });
        return next;
      });
    } catch (err) {
      console.error(`Failed to load epoch ${epoch}:`, err);
    } finally {
      setLoadingEpochs(prev => {
        const next = new Set(prev);
        next.delete(epoch);
        return next;
      });
    }
  }, [epochData, loadingEpochs, novelId]);

  // All epochs from 1 to currentEpoch (epoch 0 merges into 1)
  const maxEpoch = Math.max(displayEpoch, 1);

  return (
    <StoryTree
      epochData={epochData}
      maxEpoch={maxEpoch}
      loadingEpochs={loadingEpochs}
      onExpandEpoch={loadEpoch}
      novelId={novelId}
      votingRoundId={votingRoundId}
      connectedAddress={address}
      continuable={continuable}
      activeWorldLineIds={activeWorldLineIds}
      forkSourceNovelId={forkSourceNovelId}
      forkSourceChapterId={forkSourceChapterId}
    />
  );
}

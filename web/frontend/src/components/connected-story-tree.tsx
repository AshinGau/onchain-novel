"use client";

import { useAccount } from "wagmi";
import { StoryTree } from "@/components/story-tree";
import type { TreeChapter } from "@/lib/api";

export function ConnectedStoryTree({ chapters, novelId, votingRoundId, continuable }: {
  chapters: TreeChapter[];
  novelId: string;
  votingRoundId?: string;
  continuable?: boolean;
}) {
  const { address } = useAccount();
  return <StoryTree chapters={chapters} novelId={novelId} votingRoundId={votingRoundId} connectedAddress={address} continuable={continuable} />;
}

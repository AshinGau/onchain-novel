"use client";

import { useAccount } from "wagmi";
import { StoryTree } from "@/components/story-tree";
import type { TreeChapter } from "@/lib/api";

export function ConnectedStoryTree({ chapters, novelId, votingRoundId }: {
  chapters: TreeChapter[];
  novelId: string;
  votingRoundId?: string;
}) {
  const { address } = useAccount();
  return <StoryTree chapters={chapters} novelId={novelId} votingRoundId={votingRoundId} connectedAddress={address} />;
}

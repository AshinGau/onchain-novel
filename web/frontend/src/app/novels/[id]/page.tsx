import { NovelInfo } from "@/components/novel-info";
import { VoteCandidates } from "@/components/vote-candidates";
import { fetchNovel, fetchNovelTree, fetchRound, fetchWorldlines } from "@/lib/api";

import { NovelWorldlines } from "./novel-worldlines";

export default async function NovelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Fetch worldlines first to know how deep we need to load the tree.
  const [novel, wlData] = await Promise.all([fetchNovel(id), fetchWorldlines(id)]);

  // Tree must include the world-line heads and a little buffer for fresh
  // descendants submitted after the last settle. Fall back to 10 when empty.
  const maxDepth =
    wlData.worldlines.length === 0
      ? 10
      : Math.max(10, ...wlData.worldlines.map((w) => Number(w.depth) + 3));
  const treeData = await fetchNovelTree(id, maxDepth);

  // If a round is in progress (phase != Idle), fetch its candidates
  let roundCandidates: Awaited<ReturnType<typeof fetchRound>>["candidates"] = [];
  if (novel.round_phase > 0 && novel.current_round > 0) {
    try {
      const round = await fetchRound(id, novel.current_round);
      roundCandidates = round.candidates;
    } catch {
      // Round data not yet indexed; ignore
    }
  }

  // Compute continuation readiness: how many world lines have at least one descendant?
  const worldLineCount = Number(novel.config?.worldLineCount ?? 0);
  const worldlineIds = new Set(wlData.worldlines.map((w) => w.id));
  const parentIdsWithChildren = new Set(
    treeData.chapters.filter((c) => worldlineIds.has(c.parent_id)).map((c) => c.parent_id),
  );
  const worldlinesWithContinuations = wlData.worldlines.filter((w) =>
    parentIdsWithChildren.has(w.id),
  ).length;

  return (
    <div className="on-container on-stack">
      <NovelInfo
        novel={novel}
        worldLineCount={worldLineCount}
        worldlinesWithContinuations={worldlinesWithContinuations}
        totalWorldlines={wlData.worldlines.length}
      />

      {roundCandidates.length > 0 && (
        <VoteCandidates
          novelId={id}
          round={novel.current_round}
          phase={novel.round_phase}
          voteStake={novel.config?.voteStake || "0"}
          candidates={roundCandidates}
          chapters={treeData.chapters}
        />
      )}

      <NovelWorldlines novelId={id} chapters={treeData.chapters} worldlines={wlData.worldlines} />
    </div>
  );
}

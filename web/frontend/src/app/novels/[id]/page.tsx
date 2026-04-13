import { fetchNovel, fetchNovelTree, fetchWorldlines, fetchRound } from "@/lib/api";
import { NovelInfo } from "@/components/novel-info";
import { VoteCandidates } from "@/components/vote-candidates";
import { NovelWorldlines } from "./novel-worldlines";

export default async function NovelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [novel, treeData, wlData] = await Promise.all([
    fetchNovel(id),
    fetchNovelTree(id),
    fetchWorldlines(id),
  ]);

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
    treeData.chapters.filter((c) => worldlineIds.has(c.parent_id)).map((c) => c.parent_id)
  );
  const worldlinesWithContinuations = wlData.worldlines.filter((w) =>
    parentIdsWithChildren.has(w.id)
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

      <NovelWorldlines
        novelId={id}
        chapters={treeData.chapters}
        worldlines={wlData.worldlines}
      />
    </div>
  );
}

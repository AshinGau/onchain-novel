import { NovelInfo } from "@/components/novel-info";
import { VoteCandidates } from "@/components/vote-candidates";
import {
  fetchNovel,
  fetchNovelLines,
  fetchNovelTree,
  fetchRound,
  fetchWorldlines,
} from "@/lib/api";

import { NovelWorldlines } from "./novel-worldlines";

const DEFAULT_MODE = "longest" as const;

export default async function NovelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Worldlines (canon ancestors) feed the "ready for next round" badge in NovelInfo.
  // Lines (default = longest chains) feed the main visualization.
  const [novel, wlData, linesData] = await Promise.all([
    fetchNovel(id),
    fetchWorldlines(id),
    fetchNovelLines(id, DEFAULT_MODE),
  ]);

  // Vote candidates section still needs the chapter tree for context lookup.
  let roundCandidates: Awaited<ReturnType<typeof fetchRound>>["candidates"] = [];
  let candidateChapters: Awaited<ReturnType<typeof fetchNovelTree>>["chapters"] = [];
  if (novel.round_phase > 0 && novel.current_round > 0) {
    try {
      const [round, treeData] = await Promise.all([
        fetchRound(id, novel.current_round),
        fetchNovelTree(
          id,
          wlData.worldlines.length === 0
            ? 10
            : Math.max(10, ...wlData.worldlines.map((w) => Number(w.depth) + 3)),
        ),
      ]);
      roundCandidates = round.candidates;
      candidateChapters = treeData.chapters;
    } catch {
      // Round / tree data not yet indexed; ignore
    }
  }

  // Continuation-readiness badge: how many world-line ancestors have at least one descendant?
  const worldLineCount = Number(novel.config?.worldLineCount ?? 0);
  const ancestorsWithChildren = new Set(
    linesData.lines
      .filter((ln) => ln.chain.length > 0 && ln.chain[ln.chain.length - 1].id !== ln.ancestorId)
      .map((ln) => ln.ancestorId),
  );
  const worldlinesWithContinuations = wlData.worldlines.filter((w) =>
    ancestorsWithChildren.has(w.id),
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
          chapters={candidateChapters}
        />
      )}

      <NovelWorldlines
        novelId={id}
        initialMode={DEFAULT_MODE}
        initialLines={linesData.lines}
      />
    </div>
  );
}

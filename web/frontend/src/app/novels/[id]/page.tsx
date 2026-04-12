import { fetchNovel, fetchNovelTree, fetchWorldlines } from "@/lib/api";
import { NovelInfo } from "@/components/novel-info";
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

      <NovelWorldlines
        novelId={id}
        chapters={treeData.chapters}
        worldlines={wlData.worldlines}
      />
    </div>
  );
}

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

  return (
    <div className="on-container on-stack">
      <NovelInfo novel={novel} />

      <NovelWorldlines
        novelId={id}
        chapters={treeData.chapters}
        worldlines={wlData.worldlines}
      />
    </div>
  );
}

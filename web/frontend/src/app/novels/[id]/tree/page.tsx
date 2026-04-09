import { fetchNovel, fetchNovelTree } from "@/lib/api";
import { TreePageClient } from "./tree-page-client";

export default async function TreePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [novel, treeData] = await Promise.all([
    fetchNovel(id),
    fetchNovelTree(id),
  ]);

  return (
    <div className="on-container on-stack">
      <div className="on-row-between">
        <div className="on-row">
          <a href={`/novels/${id}`} className="text-link text-caption">
            ← {novel.title || `Novel #${id}`}
          </a>
          <h1 className="text-heading">Story Tree</h1>
        </div>
        <span className="text-caption">{treeData.chapters.length} chapters</span>
      </div>

      <TreePageClient novelId={id} chapters={treeData.chapters} />

      <p className="text-caption on-text-center">
        Click a node to view chapter details. Scroll to zoom, drag to pan.
      </p>
    </div>
  );
}

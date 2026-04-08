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
    <div className="v2-container v2-stack" style={{ paddingTop: "1.5rem", paddingBottom: "2rem" }}>
      <div className="v2-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className="v2-row" style={{ gap: "0.75rem" }}>
          <a
            href={`/novels/${id}`}
            className="text-caption"
            style={{ color: "var(--color-v2-primary)", textDecoration: "none" }}
          >
            &larr; {novel.title || `Novel #${id}`}
          </a>
          <h1 className="text-heading" style={{ margin: 0 }}>
            Story Tree
          </h1>
        </div>
        <span className="text-caption">
          {treeData.chapters.length} chapters
        </span>
      </div>

      <TreePageClient novelId={id} chapters={treeData.chapters} />

      <p className="text-caption text-muted" style={{ textAlign: "center" }}>
        Click a node to view chapter details. Scroll to zoom, drag to pan.
      </p>
    </div>
  );
}

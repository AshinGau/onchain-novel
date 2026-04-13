import { fetchNovel, fetchNovelTree } from "@/lib/api";
import { TreePageClient } from "./tree-page-client";

const DEPTH_PAGE_SIZE = 10;

export default async function TreePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [novel, treeData] = await Promise.all([
    fetchNovel(id),
    fetchNovelTree(id, DEPTH_PAGE_SIZE),
  ]);

  return (
    <div className="on-container on-stack">
      <div className="on-row-between">
        <div className="on-row" style={{ gap: "1rem" }}>
          <a href={`/novels/${id}`} className="text-link text-caption">
            ← {novel.title || `Novel #${id}`}
          </a>
          <h1 className="text-heading">Story Tree</h1>
        </div>
        <div className="on-row" style={{ gap: "1rem" }}>
          <span className="text-caption">{treeData.chapters.length} chapters</span>
        </div>
      </div>

      <TreePageClient
        novelId={id}
        initialChapters={treeData.chapters}
        initialHasMore={treeData.hasMore}
        initialMaxDepth={treeData.maxDepth}
        depthPageSize={DEPTH_PAGE_SIZE}
      />

      <div className="on-row-between" style={{ flexWrap: "wrap" }}>
        <div className="on-row" style={{ gap: "1rem" }}>
          <span className="on-row" style={{ gap: "0.25rem" }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--color-primary)", display: "inline-block" }} />
            <span className="text-tiny">World Line</span>
          </span>
          <span className="on-row" style={{ gap: "0.25rem" }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, border: "2px solid var(--color-primary)", background: "var(--color-bg)", display: "inline-block" }} />
            <span className="text-tiny">Read</span>
          </span>
          <span className="on-row" style={{ gap: "0.25rem" }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, border: "1.5px solid var(--color-border)", background: "var(--color-bg)", display: "inline-block" }} />
            <span className="text-tiny">Chapter</span>
          </span>
        </div>
        <p className="text-tiny">
          Click a node to pick an action. Scroll to zoom, drag to pan.
        </p>
      </div>
    </div>
  );
}

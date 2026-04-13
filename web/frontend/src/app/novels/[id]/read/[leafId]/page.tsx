import { fetchChapterContext, fetchNovel } from "@/lib/api";
import { ReadPageClient } from "./read-page-client";

export default async function ReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; leafId: string }>;
  searchParams: Promise<{ depth?: string }>;
}) {
  const { id, leafId } = await params;
  const { depth } = await searchParams;

  const [novel, contextData] = await Promise.all([
    fetchNovel(id),
    fetchChapterContext(leafId),
  ]);

  return (
    <div className="on-container" style={{ paddingTop: "1.5rem", paddingBottom: "3rem" }}>
      <div style={{ marginBottom: "1rem" }}>
        <a
          href={`/novels/${id}`}
          className="text-caption"
          style={{ color: "var(--color-primary)", textDecoration: "none" }}
        >
          &larr; Back to {novel.title || `Novel #${id}`}
        </a>
      </div>
      <ReadPageClient
        chapters={contextData.ancestors}
        novelId={id}
        novelTitle={novel.title}
        leafId={leafId}
        initialDepthParam={depth ? Number(depth) : undefined}
      />
    </div>
  );
}

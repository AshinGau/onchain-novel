import { fetchChapter, fetchNovel } from "@/lib/api";
import { ChapterPageClient } from "./chapter-page-client";

export default async function ChapterPage({
  params,
}: {
  params: Promise<{ id: string; chapterId: string }>;
}) {
  const { id, chapterId } = await params;

  const [chapter, novel] = await Promise.all([
    fetchChapter(chapterId),
    fetchNovel(id),
  ]);

  return (
    <div className="on-container" style={{ paddingTop: "1.5rem", paddingBottom: "3rem" }}>
      <ChapterPageClient chapter={chapter} novel={novel} />
    </div>
  );
}

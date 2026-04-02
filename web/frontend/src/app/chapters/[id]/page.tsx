import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchApi, type Chapter } from "@/lib/api";
import { shortenAddress, timeAgo } from "@/lib/format";
import { CommentSection } from "@/components/comment-section";
import { ReportModal } from "@/components/report-modal";

interface SiblingChapter {
  id: string;
  author: string;
  chapter_index: number;
  vote_count: string;
  is_world_line: boolean;
  is_canon: boolean;
}

export default async function ChapterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let chapter: Chapter;
  let siblings: SiblingChapter[] = [];
  let children: SiblingChapter[] = [];

  try {
    chapter = await fetchApi<Chapter>(`/api/chapters/${id}`);
  } catch {
    notFound();
  }

  try {
    const sibData = await fetchApi<{ siblings: SiblingChapter[] }>(`/api/chapters/${id}/siblings`);
    siblings = sibData.siblings;
  } catch {}

  try {
    const childData = await fetchApi<{ children: SiblingChapter[] }>(`/api/chapters/${id}/children`);
    children = childData.children;
  } catch {}

  let comments: { id: number; author_address: string | null; content: string; created_at: string }[] = [];
  try {
    const commentData = await fetchApi<{ comments: typeof comments }>(`/api/chapters/${id}/comments`);
    comments = commentData.comments;
  } catch {}

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-neutral-400 mb-2">
          <Link href={`/novels/${chapter.novel_id}`} className="hover:text-white">
            {chapter.novel_title || `Novel #${chapter.novel_id}`}
          </Link>
          <span>·</span>
          <span>Chapter Index {chapter.chapter_index}</span>
          <span>·</span>
          <span>Round {chapter.round} / Epoch {chapter.epoch}</span>
        </div>
        <h1 className="text-xl font-bold">Chapter #{chapter.id}</h1>
        <div className="flex items-center gap-2 mt-1 text-sm">
          <span className="text-neutral-400">by {shortenAddress(chapter.author)}</span>
          <span className="text-neutral-600">·</span>
          <span className="text-neutral-500">{chapter.vote_count} votes</span>
          {chapter.created_at && (
            <>
              <span className="text-neutral-600">·</span>
              <span className="text-neutral-500">{timeAgo(chapter.created_at)}</span>
            </>
          )}
          {chapter.is_canon && <Badge className="bg-amber-600 text-xs">Canon</Badge>}
          {chapter.is_world_line && !chapter.is_canon && <Badge className="bg-green-700 text-xs">World Line</Badge>}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex gap-2 mb-6">
        {chapter.parent_id !== "0" && Number(chapter.parent_id) > 0 && (
          <Link href={`/chapters/${chapter.parent_id}`}>
            <button className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700">
              ← Previous
            </button>
          </Link>
        )}
        <Link href={`/novels/${chapter.novel_id}`}>
          <button className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700">
            Story Tree
          </button>
        </Link>
      </div>

      {/* Content */}
      <article className="prose prose-invert prose-neutral max-w-none mb-8 leading-relaxed text-neutral-200">
        {chapter.content_text ? (
          <div className="whitespace-pre-wrap">{chapter.content_text}</div>
        ) : (
          <p className="text-neutral-500 italic">Content not yet fetched. Hash: {chapter.content_hash}</p>
        )}
      </article>

      {/* Children (next chapters) */}
      {children.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-2 text-sm text-neutral-400">Continuations ({children.length})</h2>
          <div className="space-y-1">
            {children.map(c => (
              <Link key={c.id} href={`/chapters/${c.id}`} className="flex items-center justify-between rounded-md bg-neutral-900 border border-neutral-800 p-2 hover:border-neutral-600 text-sm">
                <span>Chapter #{c.id} by {shortenAddress(c.author)}</span>
                <div className="flex items-center gap-2">
                  <span className="text-neutral-500">{c.vote_count} votes</span>
                  {c.is_canon && <Badge className="bg-amber-600 text-xs">Canon</Badge>}
                  {c.is_world_line && !c.is_canon && <Badge className="bg-green-700 text-xs">WL</Badge>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Siblings */}
      {siblings.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-2 text-sm text-neutral-400">Other continuations from the same point ({siblings.length})</h2>
          <div className="space-y-1">
            {siblings.map(s => (
              <Link key={s.id} href={`/chapters/${s.id}`} className="flex items-center justify-between rounded-md bg-neutral-900 border border-neutral-800 p-2 hover:border-neutral-600 text-sm">
                <span>Chapter #{s.id} by {shortenAddress(s.author)}</span>
                <div className="flex items-center gap-2">
                  <span className="text-neutral-500">{s.vote_count} votes</span>
                  {s.is_canon && <Badge className="bg-amber-600 text-xs">Canon</Badge>}
                  {s.is_world_line && !s.is_canon && <Badge className="bg-green-700 text-xs">WL</Badge>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-4 border-t border-neutral-800 pt-4">
        <Link href={`/write/${chapter.novel_id}/${chapter.id}`}>
          <Button variant="outline">Continue this story</Button>
        </Link>
        {!chapter.is_canon && (
          <Link href={`/fork/${chapter.novel_id}/${chapter.id}`}>
            <Button variant="outline">Fork from here</Button>
          </Link>
        )}
        <ReportModal novelId={chapter.novel_id} chapterId={id} />
      </div>

      {/* Comments */}
      <div className="mt-6 border-t border-neutral-800 pt-4">
        <h2 className="font-semibold mb-2">Comments</h2>
        <CommentSection chapterId={id} initialComments={comments} />
      </div>
    </div>
  );
}

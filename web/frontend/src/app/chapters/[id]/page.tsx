import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchApi, type Chapter, type Novel } from "@/lib/api";
import { shortenAddress, timeAgo } from "@/lib/format";
import { computeVotingRoundId } from "@/lib/contracts";
import { CommentSection } from "@/components/comment-section";
import { ReportModal } from "@/components/report-modal";
import { VoteButton } from "@/components/vote-button";
import { ChapterListItem } from "@/components/chapter-list-item";

interface SiblingChapter {
  id: string;
  author: string;
  chapter_index: number;
  round: number;
  epoch: number;
  vote_count: string;
  is_world_line: boolean;
  is_canon: boolean;
}

export default async function ChapterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let chapter: Chapter;
  let siblings: SiblingChapter[] = [];
  let children: SiblingChapter[] = [];
  let novel: Novel | null = null;

  try {
    chapter = await fetchApi<Chapter>(`/api/chapters/${id}`);
  } catch {
    notFound();
  }

  try {
    novel = await fetchApi<Novel>(`/api/novels/${chapter.novel_id}`);
  } catch {}

  try {
    const sibData = await fetchApi<{ siblings: SiblingChapter[] }>(`/api/chapters/${id}/siblings`);
    siblings = sibData.siblings;
  } catch {}

  try {
    const childData = await fetchApi<{ children: SiblingChapter[] }>(`/api/chapters/${id}/children`);
    children = childData.children;
  } catch {}

  let isActiveWorldLine = false;
  try {
    const wlData = await fetchApi<{ worldlines: { id: string }[] }>(`/api/novels/${chapter.novel_id}/worldlines`);
    isActiveWorldLine = wlData.worldlines.some(wl => wl.id === id);
  } catch {}

  let comments: { id: number; author_address: string | null; content: string; created_at: string }[] = [];
  try {
    const commentData = await fetchApi<{ comments: typeof comments }>(`/api/chapters/${id}/comments`);
    comments = commentData.comments;
  } catch {}

  // Can vote for this chapter if it's in the current voting round
  const isRoundVoting = novel && novel.active && novel.epoch_phase === 0
    && (novel.round_phase === 1 || novel.round_phase === 2)
    && chapter.round === novel.current_round;

  const votingRoundId = novel && isRoundVoting
    ? computeVotingRoundId(BigInt(chapter.novel_id), novel.current_epoch, novel.current_round, false)
    : "";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-neutral-400 mb-2">
          <Link href={`/novels/${chapter.novel_id}`} className="hover:text-white">
            {chapter.novel_title || `Novel #${chapter.novel_id}`}
          </Link>
          <span>·</span>
          <span>Chapter #{chapter.chapter_index}</span>
          <span>·</span>
          <span>Round {chapter.round} / Epoch {chapter.epoch}</span>
        </div>
        <h1 className="text-xl font-bold">Candidate(ID.{chapter.id})</h1>
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

      {/* Vote for this chapter */}
      {isRoundVoting && novel && (
        <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4 mb-6">
          <h3 className="font-semibold text-sm mb-2">
            Round {novel.current_round} — {novel.round_phase === 1 ? "Commit Phase" : "Reveal Phase"}
          </h3>
          <VoteButton
            novelId={chapter.novel_id}
            chapterId={id}
            votingRoundId={votingRoundId}
            phase={novel.round_phase === 1 ? "committing" : "revealing"}
          />
        </div>
      )}

      {/* Children (next chapters) */}
      {children.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-2 text-sm text-neutral-400">Continuations ({children.length})</h2>
          <div className="space-y-1">
            {children.map(c => <ChapterListItem key={c.id} {...c} />)}
          </div>
        </div>
      )}

      {/* Siblings */}
      {siblings.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-2 text-sm text-neutral-400">Parallel Universes ({siblings.length})</h2>
          <div className="space-y-1">
            {siblings.map(s => <ChapterListItem key={s.id} {...s} />)}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-4 border-t border-neutral-800 pt-4">
        {isActiveWorldLine && novel?.active && novel.epoch_phase === 0 && novel.round_phase === 0 && (
          <Link href={`/write/${chapter.novel_id}/${chapter.id}`}>
            <Button variant="outline">Continue this story</Button>
          </Link>
        )}
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchApi, type Chapter, type Novel } from "@/lib/api";
import { shortenAddress, timeAgo } from "@/lib/format";
import { computeVotingRoundId } from "@/lib/contracts";
import { CommentSection } from "@/components/comment-section";
import { ReportModal } from "@/components/report-modal";
import { VoteButton } from "@/components/vote-button";

interface SiblingChapter { id: string; author: string; chapter_index: number; vote_count: string; is_world_line: boolean; is_canon: boolean; }

export default async function ChapterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let chapter: Chapter; let siblings: SiblingChapter[] = []; let children: SiblingChapter[] = []; let novel: Novel | null = null;

  try { chapter = await fetchApi<Chapter>(`/api/chapters/${id}`); } catch { notFound(); }
  try { novel = await fetchApi<Novel>(`/api/novels/${chapter.novel_id}`); } catch {}
  try { siblings = (await fetchApi<{ siblings: SiblingChapter[] }>(`/api/chapters/${id}/siblings`)).siblings; } catch {}
  try { children = (await fetchApi<{ children: SiblingChapter[] }>(`/api/chapters/${id}/children`)).children; } catch {}

  let comments: { id: number; author_address: string | null; content: string; created_at: string }[] = [];
  try { comments = (await fetchApi<{ comments: typeof comments }>(`/api/chapters/${id}/comments`)).comments; } catch {}

  const isRoundVoting = novel && novel.active && novel.epoch_phase === 0 && (novel.round_phase === 1 || novel.round_phase === 2) && chapter.round === novel.current_round;
  const votingRoundId = novel && isRoundVoting ? computeVotingRoundId(BigInt(chapter.novel_id), novel.current_epoch, novel.current_round, false) : "";

  return (
    <div className="container py-4 pb-5" style={{ maxWidth: 720 }}>
      {/* Header */}
      <div className="mb-4">
        <div className="d-flex align-items-center gap-2 small text-body-secondary mb-2">
          <Link href={`/novels/${chapter.novel_id}`} className="text-decoration-none text-body-secondary">{chapter.novel_title || `Novel #${chapter.novel_id}`}</Link>
          <span>&middot;</span><span>Chapter #{chapter.chapter_index}</span>
          <span>&middot;</span><span>Round {chapter.round} / Epoch {chapter.epoch}</span>
        </div>
        <h3 className="fw-bold">Candidate(ID.{chapter.id})</h3>
        <div className="d-flex align-items-center gap-2 small">
          <span className="text-body-secondary">by {shortenAddress(chapter.author)}</span>
          <span className="text-body-tertiary">&middot;</span>
          <span className="text-body-secondary">{chapter.vote_count} votes</span>
          {chapter.created_at && <><span className="text-body-tertiary">&middot;</span><span className="text-body-secondary">{timeAgo(chapter.created_at)}</span></>}
          {chapter.is_canon && <span className="badge bg-warning text-dark">Canon</span>}
          {chapter.is_world_line && !chapter.is_canon && <span className="badge bg-success">World Line</span>}
        </div>
      </div>

      {/* Navigation */}
      <div className="d-flex gap-2 mb-4">
        {chapter.parent_id !== "0" && Number(chapter.parent_id) > 0 && (
          <Link href={`/chapters/${chapter.parent_id}`} className="btn btn-outline-secondary btn-sm">&larr; Previous</Link>
        )}
        <Link href={`/novels/${chapter.novel_id}`} className="btn btn-outline-secondary btn-sm">Story Tree</Link>
      </div>

      {/* Content */}
      <article className="chapter-prose mb-4">
        {chapter.content_text ? chapter.content_text : <p className="text-body-tertiary fst-italic">Content not yet fetched. Hash: {chapter.content_hash}</p>}
      </article>

      {/* Vote */}
      {isRoundVoting && novel && (
        <div className="card mb-4"><div className="card-body">
          <h6 className="card-title">Round {novel.current_round} — {novel.round_phase === 1 ? "Commit Phase" : "Reveal Phase"}</h6>
          <VoteButton novelId={chapter.novel_id} chapterId={id} votingRoundId={votingRoundId} phase={novel.round_phase === 1 ? "committing" : "revealing"} />
        </div></div>
      )}

      {/* Children */}
      {children.length > 0 && (
        <div className="mb-4">
          <h6 className="text-body-secondary">Continuations ({children.length})</h6>
          <div className="list-group">
            {children.map(c => (
              <Link key={c.id} href={`/chapters/${c.id}`} className="list-group-item list-group-item-action d-flex justify-content-between align-items-center small">
                <span>Candidate(ID.{c.id}) by {shortenAddress(c.author)}</span>
                <div className="d-flex align-items-center gap-2">
                  <span className="text-body-secondary">{c.vote_count} votes</span>
                  {c.is_canon && <span className="badge bg-warning text-dark">Canon</span>}
                  {c.is_world_line && !c.is_canon && <span className="badge bg-secondary">WL</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Siblings */}
      {siblings.length > 0 && (
        <div className="mb-4">
          <h6 className="text-body-secondary">Parallel Universes ({siblings.length})</h6>
          <div className="list-group">
            {siblings.map(s => (
              <Link key={s.id} href={`/chapters/${s.id}`} className="list-group-item list-group-item-action d-flex justify-content-between align-items-center small">
                <span>Candidate(ID.{s.id}) by {shortenAddress(s.author)}</span>
                <div className="d-flex align-items-center gap-2">
                  <span className="text-body-secondary">{s.vote_count} votes</span>
                  {s.is_canon && <span className="badge bg-warning text-dark">Canon</span>}
                  {s.is_world_line && !s.is_canon && <span className="badge bg-secondary">WL</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="d-flex gap-2 border-top pt-3 mt-3">
        {chapter.is_world_line && novel?.active && novel.epoch_phase === 0 && novel.round_phase === 0 && (
          <Link href={`/write/${chapter.novel_id}/${chapter.id}`} className="btn btn-outline-primary btn-sm">Continue this story</Link>
        )}
        {!chapter.is_canon && <Link href={`/fork/${chapter.novel_id}/${chapter.id}`} className="btn btn-outline-secondary btn-sm">Fork from here</Link>}
        <ReportModal novelId={chapter.novel_id} chapterId={id} />
      </div>

      {/* Comments */}
      <div className="border-top pt-3 mt-4">
        <CommentSection chapterId={id} initialComments={comments} />
      </div>
    </div>
  );
}

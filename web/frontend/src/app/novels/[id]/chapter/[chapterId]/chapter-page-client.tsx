"use client";

import { useState } from "react";
import Link from "next/link";
import type { ChapterDetail, Novel, ChapterSummary } from "@/lib/api";
import { useChapterChildren, useChapterBounties, useChapterTips } from "@/hooks/use-chapter";
import { shortAddress, timeAgo } from "@/lib/format";
import { ChapterCardMini } from "@/components/chapter-card-mini";
import { ChapterEditor } from "@/components/chapter-editor";
import { VotePanel } from "@/components/vote-panel";
import { CommentList } from "@/components/comment-list";
import { TipButton } from "./tip-button";

interface Props {
  chapter: ChapterDetail;
  novel: Novel;
}

export function ChapterPageClient({ chapter, novel }: Props) {
  const [showEditor, setShowEditor] = useState(false);
  const [showChildren, setShowChildren] = useState(false);

  const { data: children } = useChapterChildren(chapter.id);
  const { data: bounties } = useChapterBounties(chapter.id);
  const { data: tips } = useChapterTips(chapter.id);

  const novelId = novel.id;
  const isCommitting = novel.round_phase === 2;
  const isRevealing = novel.round_phase === 3;

  return (
    <div className="on-stack on-stack-lg">
      {/* Breadcrumb */}
      <div className="on-row">
        <Link href={`/novels/${novelId}`} className="text-link text-caption">
          {novel.title || `Novel #${novelId}`}
        </Link>
        <span className="text-muted">/</span>
        <span className="text-caption">Chapter {chapter.id}</span>
      </div>

      {/* Navigation buttons */}
      <div className="on-row-wrap">
        {chapter.parent_id && chapter.parent_id !== "0" && (
          <Link href={`/novels/${novelId}/chapter/${chapter.parent_id}`}>
            <button type="button" className="on-btn on-btn-secondary">Previous</button>
          </Link>
        )}
        <button
          type="button"
          className="on-btn on-btn-secondary"
          onClick={() => setShowChildren(!showChildren)}
        >
          Continue ({children?.length ?? 0})
        </button>
        <Link href={`/novels/${novelId}/tree`}>
          <button type="button" className="on-btn on-btn-secondary">Story Tree</button>
        </Link>
      </div>

      {/* Children list */}
      {showChildren && children && children.length > 0 && (
        <div className="on-card">
          <h4 className="text-caption">Continuations</h4>
          {children.map((child: ChapterSummary) => (
            <ChapterCardMini key={child.id} chapter={child} novelId={novelId} />
          ))}
        </div>
      )}

      {/* Chapter meta */}
      <div className="on-card">
        <div className="on-row-wrap">
          <span className="text-caption">Author: {shortAddress(chapter.author)}</span>
          <span className="on-badge badge-depth">Depth: {chapter.depth}</span>
          {chapter.is_world_line && (
            <span className="on-badge badge-worldline">World Line</span>
          )}
          <span className="text-muted">{timeAgo(chapter.timestamp)}</span>
        </div>

        {tips && tips.length > 0 && (
          <span className="text-caption">
            {tips.length} tip{tips.length !== 1 ? "s" : ""}
          </span>
        )}
        {bounties && bounties.length > 0 && (
          <span className="text-caption">
            {bounties.length} bounty/bounties
          </span>
        )}
      </div>

      {/* Chapter content */}
      <div className="prose">
        {chapter.content_text ? (
          chapter.content_text
            .split("\n")
            .map((para, i) => (para.trim() ? <p key={i}>{para}</p> : null))
        ) : (
          <p className="text-muted">Content not available</p>
        )}
      </div>

      {/* Action buttons */}
      <div className="on-row-wrap">
        <TipButton chapterId={chapter.id} />
        <button
          type="button"
          className="on-btn on-btn-primary"
          onClick={() => setShowEditor(!showEditor)}
        >
          {showEditor ? "Cancel" : "Write continuation"}
        </button>
      </div>

      {/* Vote panel (if in committing/revealing phase) */}
      {(isCommitting || isRevealing) && (
        <VotePanel
          novelId={novelId}
          round={novel.current_round}
          phase={novel.round_phase}
          candidateId={chapter.id}
          voteStake={novel.config?.voteStake || "0"}
        />
      )}

      {/* Chapter editor */}
      {showEditor && (
        <ChapterEditor
          novelId={novelId}
          parentId={chapter.id}
          submissionFee={novel.config?.submissionFee || "0"}
          minLength={novel.config?.minChapterLength || 100}
          maxLength={novel.config?.maxChapterLength || 50000}
          contentLocation={novel.config?.contentLocation || 0}
          onSuccess={() => setShowEditor(false)}
        />
      )}

      {/* Comments (off-chain, signed) */}
      <CommentList chapterId={chapter.id} />
    </div>
  );
}

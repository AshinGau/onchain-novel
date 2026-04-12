"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { parseEther, formatEther } from "viem";
import type { ChapterDetail, Novel, ChapterSummary, Bounty } from "@/lib/api";
import { useChapterChildren, useChapterBounties, useChapterTips } from "@/hooks/use-chapter";
import { timeAgo } from "@/lib/format";
import { useNicknames } from "@/hooks/use-nickname";
import { TOKEN_SYMBOL } from "@/lib/config";
import { BOUNTY_BOARD_ADDRESS, bountyBoardAbi } from "@/lib/contracts";
import { useTxAction } from "@/hooks/use-tx-action";
import { ChapterCardMini } from "@/components/chapter-card-mini";
import { ChapterEditor } from "@/components/chapter-editor";
import { VotePanel } from "@/components/vote-panel";
import { CommentList } from "@/components/comment-list";
import { TipButton } from "./tip-button";

/* ── Sponsor Next Chapter (追更) form ── */
function BountyCreateForm({ chapterId, onClose }: { chapterId: string; onClose: () => void }) {
  const [amount, setAmount] = useState("0.01");
  const [days, setDays] = useState("7");
  const { send, isPending, status, error } = useTxAction();

  async function handleCreate() {
    const value = parseEther(amount);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(days) * 86400);
    await send(
      {
        address: BOUNTY_BOARD_ADDRESS,
        abi: bountyBoardAbi,
        functionName: "createBounty",
        args: [BigInt(chapterId), deadline],
        value,
      },
      () => onClose()
    );
  }

  return (
    <div className="on-card on-stack" style={{ gap: "0.5rem" }}>
      <h4 className="text-caption" style={{ margin: 0 }}>Sponsor Next Chapter</h4>
      <div className="on-row">
        <div>
          <label className="text-tiny">Amount ({TOKEN_SYMBOL})</label>
          <input type="text" className="on-form-input on-form-input-narrow" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="text-tiny">Deadline (days)</label>
          <input type="text" className="on-form-input on-form-input-narrow" value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
      </div>
      <p className="text-muted" style={{ fontSize: "0.75rem", margin: 0 }}>
        20% goes to prize pool. 80% locked for authors. You can designate a favorite before the deadline.
      </p>
      <div className="on-row">
        <button type="button" className="on-btn on-btn-primary" onClick={handleCreate} disabled={isPending}>
          {isPending ? "…" : "Create Bounty"}
        </button>
        <button type="button" className="on-btn on-btn-ghost" onClick={onClose}>Cancel</button>
      </div>
      {status === "success" && <span className="text-success">Bounty created!</span>}
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}

/* ── Active bounty list for a chapter ── */
function BountyList({ bounties, chapterId, displayName }: { bounties: Bounty[]; chapterId: string; displayName: (addr: string) => string }) {
  const now = Math.floor(Date.now() / 1000);

  const active = bounties.filter((b) => !b.claimed && Number(b.deadline) > now);
  if (active.length === 0) return null;

  return (
    <div className="on-card on-stack" style={{ gap: "0.5rem" }}>
      <h4 className="text-caption" style={{ margin: 0 }}>Active Bounties ({active.length})</h4>
      {active.map((b) => {
        const remaining = Number(b.deadline) - now;
        const days = Math.floor(remaining / 86400);
        const hours = Math.floor((remaining % 86400) / 3600);
        const designated = Number(b.designated_chapter_id || 0);

        return (
          <div key={b.id} style={{
            padding: "0.5rem 0.75rem", borderRadius: "0.375rem",
            background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)",
          }}>
            <div className="on-row-wrap" style={{ gap: "0.5rem" }}>
              <span style={{ fontWeight: 600, color: "var(--color-warning)" }}>
                {formatEther(BigInt(b.locked_amount))} {TOKEN_SYMBOL}
              </span>
              <span className="text-muted">
                {days > 0 ? `${days}d ${hours}h remaining` : `${hours}h remaining`}
              </span>
              <span className="text-muted">by {displayName(b.tipper)}</span>
              {designated > 0 && (
                <span className="on-badge badge-active">
                  Designated: Chapter #{designated}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  chapter: ChapterDetail;
  novel: Novel;
}

export function ChapterPageClient({ chapter, novel }: Props) {
  const [showEditor, setShowEditor] = useState(false);
  const [showChildren, setShowChildren] = useState(false);
  const [showBountyForm, setShowBountyForm] = useState(false);
  const { isConnected } = useAccount();

  const { data: children } = useChapterChildren(chapter.id);
  const { data: bounties } = useChapterBounties(chapter.id);
  const { data: tips } = useChapterTips(chapter.id);

  const addrList = [chapter.author, ...(bounties ?? []).map((b) => b.tipper)];
  const displayName = useNicknames(addrList);

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
        <span className="text-caption">Chapter {chapter.depth} (ID.{chapter.id})</span>
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
          Next Chapters ({children?.length ?? 0})
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
          <span className="text-caption">Author: {displayName(chapter.author)}</span>
          <span className="on-badge badge-depth">#{chapter.depth}</span>
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
      </div>

      {/* Active bounties */}
      {bounties && <BountyList bounties={bounties} chapterId={chapter.id} displayName={displayName} />}

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
          {showEditor ? "Cancel" : "Write Next Chapter"}
        </button>
        <Link href={`/fork/${novelId}/${chapter.id}`}>
          <button type="button" className="on-btn on-btn-secondary">Fork Novel</button>
        </Link>
        {isConnected && (
          <button
            type="button"
            className="on-btn on-btn-secondary"
            onClick={() => setShowBountyForm(!showBountyForm)}
          >
            {showBountyForm ? "Cancel" : "Sponsor Next Chapter"}
          </button>
        )}
      </div>

      {/* Bounty creation form */}
      {showBountyForm && (
        <BountyCreateForm chapterId={chapter.id} onClose={() => setShowBountyForm(false)} />
      )}

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

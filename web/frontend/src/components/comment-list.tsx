"use client";

/**
 * Comment list + signed POST form for a chapter.
 *
 * Per docs/backend.md §5: comments are off-chain, append-only, authenticated by
 * EIP-191 wallet signature over the canonical message
 *   `Comment on chapter {id} at {ts}: {content}`.
 *
 * No on-chain transaction. The wallet only signs the message.
 */
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

import { useNicknames } from "@/hooks/use-nickname";
import { fetchComments, postComment, type Comment } from "@/lib/api";
import { timeAgo } from "@/lib/format";

interface Props {
  chapterId: string;
}

export function CommentList({ chapterId }: Props) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayName = useNicknames(comments.map((c) => c.author));

  async function refresh() {
    try {
      const { comments } = await fetchComments(chapterId);
      setComments(comments);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  async function handleSubmit() {
    if (!address || !content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = content.trim();
      const ts = Math.floor(Date.now() / 1000);
      const message = `Comment on chapter ${chapterId} at ${ts}: ${trimmed}`;
      const signature = await signMessageAsync({ message });

      const result = await postComment(chapterId, {
        address,
        content: trimmed,
        timestamp: ts,
        signature,
      });

      if (result.ok) {
        setContent("");
        // Optimistically prepend; backend's GET is sorted DESC by created_at.
        setComments((prev) => [result.comment, ...prev]);
      } else {
        setError(`Backend rejected comment (${result.status}): ${result.error}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="on-card">
      <h3 className="text-subheading">Comments</h3>

      {/* Submit form */}
      {isConnected ? (
        <div className="on-stack on-stack-sm">
          <textarea
            className="on-form-textarea"
            placeholder="Leave a comment (signed by your wallet, no gas)"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={5000}
            disabled={submitting}
          />
          <div className="on-row-between">
            <span className="text-muted">{content.length}/5000</span>
            <div className="on-row">
              {submitting && (
                <span className="text-tiny text-muted">Sign in your wallet — free, no gas</span>
              )}
              <button
                type="button"
                className="on-btn on-btn-primary"
                onClick={handleSubmit}
                disabled={submitting || !content.trim()}
              >
                {submitting ? "Signing…" : "Post Comment"}
              </button>
            </div>
          </div>
          {error && <p className="text-danger">{error}</p>}
        </div>
      ) : (
        <div className="on-row">
          <span className="text-caption">Connect wallet to comment</span>
          <ConnectButton />
        </div>
      )}

      {/* Comment list */}
      <div className="on-stack on-stack-sm">
        {loading ? (
          <p className="text-muted">Loading comments…</p>
        ) : comments.length === 0 ? (
          <p className="text-muted">No comments yet.</p>
        ) : (
          comments.map((c) => (
            <article key={c.id} className="on-comment">
              <div className="on-comment-meta">
                <span>{displayName(c.author)}</span>
                <span>·</span>
                <span>{timeAgo(c.created_at)}</span>
              </div>
              <p className="on-comment-body">{c.content}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

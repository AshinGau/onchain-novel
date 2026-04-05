"use client";

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { API_BASE, signedFetch } from "@/lib/api";
import { shortenAddress, timeAgo } from "@/lib/format";

interface Comment {
  id: number;
  author_address: string | null;
  content: string;
  created_at: string;
}

export function CommentSection({ chapterId, initialComments }: { chapterId: string; initialComments: Comment[] }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshComments() {
    try {
      const res = await fetch(`${API_BASE}/api/chapters/${chapterId}/comments`);
      if (res.ok) { const data = await res.json(); setComments(data.comments); }
    } catch {}
  }

  async function handlePost() {
    if (!content.trim() || !address) return;
    setPosting(true); setError(null);
    try {
      const res = await signedFetch(`${API_BASE}/api/chapters/${chapterId}/comments`, "POST", { content: content.trim() }, address!, signMessageAsync);
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || "Failed to post comment"); }
      setContent(""); await refreshComments();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to post"); }
    finally { setPosting(false); }
  }

  async function handleDelete(commentId: number) {
    if (!address) return;
    try {
      const res = await signedFetch(`${API_BASE}/api/chapters/${chapterId}/comments/${commentId}`, "DELETE", {}, address!, signMessageAsync);
      if (res.ok) await refreshComments();
    } catch {}
  }

  return (
    <div>
      <h5>Comments ({comments.length})</h5>

      <div className="mb-3">
        <textarea value={content} onChange={(e) => setContent(e.target.value)}
          placeholder={isConnected ? "Write a comment..." : "Connect wallet to comment"}
          disabled={!isConnected || posting} maxLength={5000} rows={3}
          className="form-control mb-2" />
        <div className="d-flex justify-content-between align-items-center">
          <span className="small text-body-tertiary">{content.length}/5000</span>
          <button className="btn btn-primary btn-sm" onClick={handlePost} disabled={!isConnected || !content.trim() || posting}>
            {posting ? "Posting..." : "Post Comment"}
          </button>
        </div>
        {error && <div className="text-danger small mt-1">{error}</div>}
      </div>

      <div className="d-flex flex-column gap-2">
        {comments.length === 0 && <p className="text-body-tertiary small">No comments yet. Be the first!</p>}
        {comments.map((comment) => (
          <div key={comment.id} className="card card-body p-2">
            <div className="d-flex justify-content-between align-items-center">
              <div className="d-flex align-items-center gap-2 small">
                <span className="font-monospace text-body-secondary">
                  {comment.author_address ? shortenAddress(comment.author_address) : "Anonymous"}
                </span>
                <span className="text-body-tertiary">{timeAgo(comment.created_at)}</span>
              </div>
              {address && comment.author_address && address.toLowerCase() === comment.author_address.toLowerCase() && (
                <button onClick={() => handleDelete(comment.id)} className="btn btn-link btn-sm text-danger p-0">Delete</button>
              )}
            </div>
            <p className="small mb-0 mt-1" style={{ whiteSpace: "pre-wrap" }}>{comment.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

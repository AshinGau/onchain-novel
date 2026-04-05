"use client";

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { Button } from "@/components/ui/button";
import { API_BASE, signedFetch } from "@/lib/api";
import { shortenAddress, timeAgo } from "@/lib/format";

interface Comment {
  id: number;
  author_address: string | null;
  content: string;
  created_at: string;
}

export function CommentSection({
  chapterId,
  initialComments,
}: {
  chapterId: string;
  initialComments: Comment[];
}) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshComments() {
    try {
      const res = await fetch(`${API_BASE}/api/chapters/${chapterId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments);
      }
    } catch {
      // silent refresh failure
    }
  }

  async function handlePost() {
    if (!content.trim() || !address) return;
    setPosting(true);
    setError(null);
    try {
      const res = await signedFetch(
        `${API_BASE}/api/chapters/${chapterId}/comments`,
        "POST",
        { content: content.trim() },
        address!,
        signMessageAsync,
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to post comment");
      }
      setContent("");
      await refreshComments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(commentId: number) {
    if (!address) return;
    try {
      const res = await signedFetch(
        `${API_BASE}/api/chapters/${chapterId}/comments/${commentId}`,
        "DELETE",
        {},
        address!,
        signMessageAsync,
      );
      if (res.ok) {
        await refreshComments();
      }
    } catch {
      // silent delete failure
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Comments ({comments.length})</h3>

      {/* Comment input */}
      <div className="space-y-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={isConnected ? "Write a comment..." : "Connect wallet to comment"}
          disabled={!isConnected || posting}
          maxLength={5000}
          rows={3}
          className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm resize-none placeholder:text-neutral-500 disabled:opacity-50"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-500">{content.length}/5000</span>
          <Button
            size="sm"
            onClick={handlePost}
            disabled={!isConnected || !content.trim() || posting}
          >
            {posting ? "Posting..." : "Post Comment"}
          </Button>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>

      {/* Comments list */}
      <div className="space-y-3">
        {comments.length === 0 && (
          <p className="text-neutral-500 text-sm">No comments yet. Be the first!</p>
        )}
        {comments.map((comment) => (
          <div
            key={comment.id}
            className="rounded-md bg-neutral-900 border border-neutral-800 p-3 space-y-1"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-neutral-300 font-mono">
                  {comment.author_address
                    ? shortenAddress(comment.author_address)
                    : "Anonymous"}
                </span>
                <span className="text-neutral-600">-</span>
                <span className="text-neutral-500">{timeAgo(comment.created_at)}</span>
              </div>
              {address &&
                comment.author_address &&
                address.toLowerCase() === comment.author_address.toLowerCase() && (
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Delete
                  </button>
                )}
            </div>
            <p className="text-sm text-neutral-200 whitespace-pre-wrap">{comment.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

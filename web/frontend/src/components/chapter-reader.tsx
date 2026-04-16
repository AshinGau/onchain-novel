"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNicknames } from "@/hooks/use-nickname";
import type { ChapterContext } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { getReadSet, markRead, saveBookmark } from "@/lib/reading-storage";

interface ChapterReaderProps {
  /** Ordered chain from root to leaf */
  chapters: ChapterContext[];
  novelId: string;
  novelTitle: string;
  leafId: string;
  /** If the URL had ?depth=N, use it; otherwise compute from read progress. */
  initialDepthParam?: number;
}

/**
 * Resume logic: from the leaf walk up toward root.
 * The first chapter that is already read is our resume point.
 * If none are read → start from depth 1.
 */
function computeResumeIndex(chapters: ChapterContext[]): number {
  if (chapters.length === 0) return 0;
  const readSet = getReadSet();
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (readSet.has(chapters[i].id)) return i;
  }
  return 0;
}

export function ChapterReader({
  chapters,
  novelId,
  novelTitle,
  leafId,
  initialDepthParam,
}: ChapterReaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const displayName = useNicknames(chapters.map((c) => c.author));
  const total = chapters.length;

  const [index, setIndex] = useState(() => {
    if (initialDepthParam && initialDepthParam >= 1 && initialDepthParam <= total) {
      return initialDepthParam - 1;
    }
    return computeResumeIndex(chapters);
  });

  const [showPagePicker, setShowPagePicker] = useState(false);
  const [pageInput, setPageInput] = useState("");

  const current = chapters[index];

  // URL sync: write ?depth on every change (replace, no history bloat).
  // Also scroll to top so a long previous chapter doesn't leave the reader
  // stranded mid-page on the next one.
  useEffect(() => {
    const depth = index + 1;
    const currentParam = searchParams.get("depth");
    if (currentParam !== String(depth)) {
      router.replace(`/novels/${novelId}/read/${leafId}?depth=${depth}`, { scroll: false });
    }
    window.scrollTo({ top: 0 });
  }, [index, novelId, leafId, router, searchParams]);

  // Persist: mark read + upsert bookmark
  useEffect(() => {
    if (!current) return;
    markRead(current.id);
    saveBookmark({
      novelId,
      leafId,
      depth: index + 1,
      novelTitle,
    });
  }, [current, novelId, leafId, novelTitle, index]);

  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setIndex((i) => Math.min(total - 1, i + 1)), [total]);
  const goTo = useCallback((i: number) => setIndex(Math.max(0, Math.min(total - 1, i))), [total]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") goPrev();
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goNext();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goPrev, goNext]);

  if (!current) return null;

  const isLast = index === total - 1;
  const isFirst = index === 0;
  const progress = total > 1 ? ((index + 1) / total) * 100 : 100;
  const formattedDate = current.timestamp
    ? new Date(Number(current.timestamp) * 1000).toLocaleDateString()
    : null;

  return (
    <div className="on-stack" style={{ gap: "1.5rem" }}>
      {/* Top bar */}
      <div className="on-stack" style={{ gap: "0.25rem" }}>
        <div className="on-row-between">
          <span className="text-caption">
            Chapter {index + 1} of {total}
          </span>
          <span className="text-caption" style={{ color: "var(--color-primary)" }}>
            🔖 Bookmarked
          </span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Chapter meta */}
      <div className="on-row-wrap" style={{ gap: "0.5rem" }}>
        <span className="text-caption">by {displayName(current.author)}</span>
        <Link
          href={`/novels/${novelId}/chapter/${current.id}`}
          className="text-caption"
          style={{ color: "var(--color-primary)", textDecoration: "none" }}
        >
          ID.{current.id}
        </Link>
        {formattedDate && (
          <span className="text-caption text-muted">
            · {formattedDate} ({timeAgo(current.timestamp)})
          </span>
        )}
        {current.is_world_line && <span className="on-badge badge-worldline">World Line</span>}
      </div>

      {/* Content */}
      <div className="prose">
        {current.content_text ? (
          current.content_text
            .split("\n")
            .map((para, i) => (para.trim() ? <p key={i}>{para}</p> : null))
        ) : (
          <p className="text-muted" style={{ fontStyle: "italic" }}>
            Content not available
          </p>
        )}
      </div>

      {/* Navigation with pagination */}
      <div className="on-row-between" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <button
          className="on-btn on-btn-secondary"
          onClick={goPrev}
          disabled={isFirst}
          style={{ opacity: isFirst ? 0.4 : 1 }}
        >
          Previous
        </button>

        <Pagination
          current={index + 1}
          total={total}
          onGoto={(p) => goTo(p - 1)}
          open={showPagePicker}
          setOpen={setShowPagePicker}
          pageInput={pageInput}
          setPageInput={setPageInput}
        />

        {isLast ? (
          <Link
            href={`/novels/${novelId}/chapter/${current.id}`}
            style={{ textDecoration: "none" }}
          >
            <button className="on-btn on-btn-primary">Continue this storyline</button>
          </Link>
        ) : (
          <button className="on-btn on-btn-primary" onClick={goNext}>
            Next
          </button>
        )}
      </div>
    </div>
  );
}

function Pagination({
  current,
  total,
  onGoto,
  open,
  setOpen,
  pageInput,
  setPageInput,
}: {
  current: number;
  total: number;
  onGoto: (p: number) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  pageInput: string;
  setPageInput: (v: string) => void;
}) {
  function handleJump(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(pageInput);
    if (Number.isInteger(n) && n >= 1 && n <= total) {
      onGoto(n);
    }
    setPageInput("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="on-btn on-btn-ghost"
        onClick={() => {
          setPageInput(String(current));
          setOpen(true);
        }}
      >
        Chapter {current} / {total}
      </button>
    );
  }

  return (
    <form onSubmit={handleJump}>
      <input
        type="number"
        min={1}
        max={total}
        value={pageInput}
        onChange={(e) => setPageInput(e.target.value)}
        onBlur={() => setOpen(false)}
        placeholder={`1–${total}`}
        className="on-form-input on-form-input-narrow"
        style={{ width: "6rem", textAlign: "center" }}
        autoFocus
      />
    </form>
  );
}

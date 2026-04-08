"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { ChapterContext } from "@/lib/api";
import { shortAddress } from "@/lib/format";

interface ChapterReaderProps {
  /** Ordered chain from root to leaf */
  chapters: ChapterContext[];
  novelId: string;
}

export function ChapterReader({ chapters, novelId }: ChapterReaderProps) {
  const [index, setIndex] = useState(0);

  const current = chapters[index];
  const total = chapters.length;
  const isLast = index === total - 1;
  const isFirst = index === 0;

  const goPrev = useCallback(() => {
    if (!isFirst) setIndex((i) => i - 1);
  }, [isFirst]);

  const goNext = useCallback(() => {
    if (!isLast) setIndex((i) => i + 1);
  }, [isLast]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") goPrev();
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goNext();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goPrev, goNext]);

  if (!current) return null;

  const progress = total > 1 ? ((index + 1) / total) * 100 : 100;

  return (
    <div className="on-stack" style={{ gap: "1.5rem" }}>
      {/* Progress bar */}
      <div className="on-stack" style={{ gap: "0.25rem" }}>
        <div className="on-row" style={{ justifyContent: "space-between" }}>
          <span className="text-caption">
            Chapter {index + 1} of {total}
          </span>
          <span className="text-caption">
            Depth {current.depth}
          </span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Chapter meta */}
      <div className="on-row" style={{ gap: "0.75rem" }}>
        <span className="text-caption">
          by {shortAddress(current.author)}
        </span>
        {current.is_world_line && (
          <span className="on-badge badge-worldline">World Line</span>
        )}
        <Link
          href={`/novels/${novelId}/chapter/${current.id}`}
          className="text-caption"
          style={{ color: "var(--color-primary)", textDecoration: "none" }}
        >
          Ch.{current.id}
        </Link>
      </div>

      {/* Content */}
      <div className="prose">
        {current.content_text ? (
          current.content_text.split("\n").map((para, i) =>
            para.trim() ? <p key={i}>{para}</p> : null
          )
        ) : (
          <p className="text-muted" style={{ fontStyle: "italic" }}>
            Content not available
          </p>
        )}
      </div>

      {/* Navigation */}
      <div className="on-row" style={{ justifyContent: "space-between" }}>
        <button
          className="on-btn on-btn-secondary"
          onClick={goPrev}
          disabled={isFirst}
          style={{ opacity: isFirst ? 0.4 : 1 }}
        >
          Previous
        </button>
        {isLast ? (
          <Link
            href={`/novels/${novelId}/chapter/${current.id}`}
            style={{ textDecoration: "none" }}
          >
            <button className="on-btn on-btn-primary">
              Continue this storyline
            </button>
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

"use client";

import { useState } from "react";
import Link from "next/link";

interface TocItem { index: number; label: string; author: string; }

export function ChapterNav({ novelId, chapters, currentIndex }: { novelId: string; chapters: TocItem[]; currentIndex: number }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-outline-secondary btn-sm">
        {currentIndex + 1} / {chapters.length}
      </button>

      {open && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center px-3" style={{ zIndex: 1055, background: "rgba(0,0,0,0.7)" }} onClick={() => setOpen(false)}>
          <div className="card shadow-lg" style={{ width: "100%", maxWidth: 380, maxHeight: "70vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="card-header d-flex justify-content-between align-items-center">
              <span className="fw-semibold small">Chapters</span>
              <button onClick={() => setOpen(false)} className="btn-close btn-sm" />
            </div>
            <div className="list-group list-group-flush overflow-auto">
              {chapters.map((ch) => (
                <Link key={ch.index} href={`/novels/${novelId}/canon?ch=${ch.index}`} onClick={() => setOpen(false)}
                  className={`list-group-item list-group-item-action d-flex justify-content-between align-items-center small ${ch.index === currentIndex ? "active" : ""}`}>
                  <span>{ch.label}</span>
                  <span className={ch.index === currentIndex ? "" : "text-body-secondary"}>{ch.author}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

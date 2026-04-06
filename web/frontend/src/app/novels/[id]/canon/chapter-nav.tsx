"use client";

import { useState } from "react";
import Link from "next/link";

interface TocItem {
  index: number;
  label: string;
  author: string;
}

interface ChapterNavProps {
  novelId: string;
  chapters: TocItem[];
  currentIndex: number;
  forkSourceNovelId?: string | null;
  forkSourceChapterId?: string | null;
}

export function ChapterNav({ novelId, chapters, currentIndex, forkSourceNovelId, forkSourceChapterId }: ChapterNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:border-neutral-500 transition-colors"
      >
        {currentIndex + 1} / {chapters.length}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm max-h-[70vh] rounded-xl bg-neutral-900 border border-neutral-700 shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800">
              <span className="font-semibold text-sm">Chapters</span>
              <button onClick={() => setOpen(false)} className="text-neutral-500 hover:text-white text-lg leading-none">&times;</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {forkSourceNovelId && (
                <Link href={`/chapters/${forkSourceChapterId}`} onClick={() => setOpen(false)}
                  className="flex items-center justify-between px-5 py-2.5 border-b border-neutral-800/50 text-sm text-purple-400 hover:bg-purple-950/20 transition-colors">
                  <span>Fork Origin</span>
                  <span className="text-xs text-neutral-500">Novel #{forkSourceNovelId}</span>
                </Link>
              )}
              {chapters.map((ch) => (
                <Link key={ch.index} href={`/novels/${novelId}/canon?ch=${ch.index}`} onClick={() => setOpen(false)}
                  className={`flex items-center justify-between px-5 py-2.5 border-b border-neutral-800/50 last:border-b-0 text-sm transition-colors ${
                    ch.index === currentIndex ? "bg-amber-950/30 text-amber-400" : "text-neutral-300 hover:bg-neutral-800"
                  }`}>
                  <span>{ch.label}</span>
                  <span className="text-xs text-neutral-500">{ch.author}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

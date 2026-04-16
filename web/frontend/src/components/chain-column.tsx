"use client";

import Link from "next/link";

import type { ChapterSummary } from "@/lib/api";

import { ChapterCardMini } from "./chapter-card-mini";
import { CollapsedChapters } from "./collapsed-chapters";

interface ChainColumnProps {
  /** Index (1-based) for color */
  worldlineIndex: number;
  /** Full chain from root to leaf */
  chain: ChapterSummary[];
  /** The worldline ancestor chapter id (for highlight). Pass "" to skip highlight. */
  worldlineAncestorId: string;
  /** Novel id for links */
  novelId: string;
  /** Override the column heading. Defaults to "World Line N". */
  label?: string;
}

export function ChainColumn({
  worldlineIndex,
  chain,
  worldlineAncestorId,
  novelId,
  label,
}: ChainColumnProps) {
  if (chain.length === 0) return null;

  // Split chain into segments: root, pre-worldline, worldline, post-worldline, leaf
  const wlIdx = chain.findIndex((ch) => ch.id === worldlineAncestorId);
  const root = chain[0];
  const leaf = chain[chain.length - 1];

  // Chapters between root and worldline ancestor (exclusive)
  const preWl = wlIdx > 1 ? chain.slice(1, wlIdx) : [];
  // The worldline ancestor itself
  const wlChapter = wlIdx >= 0 ? chain[wlIdx] : null;
  // Chapters between worldline ancestor and leaf (exclusive)
  const postWl =
    wlIdx >= 0 && wlIdx < chain.length - 1 ? chain.slice(wlIdx + 1, chain.length - 1) : [];
  // Show leaf only if it's not the same as root or worldline
  const showLeaf = leaf.id !== root.id && leaf.id !== worldlineAncestorId;

  const leafId = leaf.id;

  return (
    <div className="worldline-column" data-wl={Math.min(worldlineIndex, 5)}>
      <div
        className="text-caption"
        style={{ textAlign: "center", fontWeight: 600, marginBottom: "0.25rem" }}
      >
        {label ?? `World Line ${worldlineIndex}`}
      </div>

      {/* Root */}
      <ChapterCardMini chapter={root} novelId={novelId} />

      {/* Pre-worldline collapsed */}
      {preWl.length > 0 && <CollapsedChapters chapters={preWl} novelId={novelId} />}

      {/* Worldline ancestor */}
      {wlChapter && wlChapter.id !== root.id && (
        <ChapterCardMini chapter={wlChapter} novelId={novelId} highlight showWorldLine />
      )}

      {/* Post-worldline collapsed */}
      {postWl.length > 0 && <CollapsedChapters chapters={postWl} novelId={novelId} />}

      {/* Leaf */}
      {showLeaf && <ChapterCardMini chapter={leaf} novelId={novelId} />}

      {/* Read storyline button */}
      <Link href={`/novels/${novelId}/read/${leafId}`} style={{ textDecoration: "none" }}>
        <button
          className="on-btn on-btn-primary"
          style={{ width: "100%", justifyContent: "center" }}
        >
          Read storyline
        </button>
      </Link>
    </div>
  );
}

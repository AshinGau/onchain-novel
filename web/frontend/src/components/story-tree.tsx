"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { TreeChapter } from "@/lib/api";
import { shortenAddress } from "@/lib/format";
import { VotedBadge } from "@/components/voted-badge";

interface EpochData {
  chapters: TreeChapter[];
  anchors: TreeChapter[];
}

interface StoryTreeProps {
  epochData: Map<number, EpochData>;
  maxEpoch: number;
  loadingEpochs: Set<number>;
  onExpandEpoch: (epoch: number) => void;
  novelId: string;
  votingRoundId?: string;
  connectedAddress?: string;
  continuable?: boolean;
  activeWorldLineIds?: Set<string>;
}

// Chapters injected as epoch anchors carry this flag
type DisplayChapter = TreeChapter & { _anchor?: boolean };

// ── Badge logic ───────────────────────────────────────────────────

function getChapterBadge(
  ch: TreeChapter,
  continuable: boolean,
  activeWorldLineIds?: Set<string>,
): { label: string; className: string } | null {
  // "Continue" only on active world lines (not just any chapter with is_world_line flag)
  if (continuable && activeWorldLineIds?.has(ch.id)) {
    return { label: "Continue", className: "bg-green-900/60 text-green-300 border-green-700" };
  }
  if (ch.is_canon) return { label: "Canon", className: "bg-amber-900/60 text-amber-300 border-amber-700" };
  if (ch.is_world_line) return { label: "World Line", className: "bg-blue-900/60 text-blue-300 border-blue-700" };
  return null;
}

// ── Recursive tree node (used inside each epoch) ──────────────────

// Count all descendants recursively
function countDescendants(id: string, childrenOf: Map<string, DisplayChapter[]>): number {
  const kids = childrenOf.get(id) || [];
  let count = kids.length;
  for (const kid of kids) count += countDescendants(kid.id, childrenOf);
  return count;
}

function TreeNode({ chapter: ch, childrenOf, depth, novelId, votingRoundId, connectedAddress, continuable, activeWorldLineIds }: {
  chapter: DisplayChapter;
  childrenOf: Map<string, DisplayChapter[]>;
  depth: number;
  novelId: string;
  votingRoundId?: string;
  connectedAddress?: string;
  continuable: boolean;
  activeWorldLineIds?: Set<string>;
}) {
  const children = childrenOf.get(ch.id) || [];
  const [collapsed, setCollapsed] = useState(false);
  const isOwn = !!connectedAddress && ch.author.toLowerCase() === connectedAddress.toLowerCase();
  const isAnchor = !!ch._anchor;
  const hasChildren = children.length > 0;
  const badge = isAnchor ? null : getChapterBadge(ch, continuable, activeWorldLineIds);

  const borderColor = isAnchor
    ? "border-amber-600 border-dashed bg-amber-950/30"
    : ch.is_canon
      ? "border-amber-600 bg-amber-950/30"
      : ch.is_world_line
        ? "border-blue-700 bg-blue-950/20"
        : "border-neutral-800 bg-neutral-900";

  return (
    <div className={depth > 0 ? "ml-5 border-l border-neutral-800 pl-3" : ""}>
      <div className="relative group/node">
        <Link
          href={`/chapters/${ch.id}`}
          className={`block rounded-lg border p-2 text-sm transition-colors hover:border-neutral-500 mb-1 ${borderColor}`}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            {isAnchor && (
              <span className="text-neutral-600 text-xs italic">from prev epoch ·</span>
            )}
            <span className="text-neutral-500 text-xs">
              {ch.round === 0 && ch.epoch === 0 ? `Bootstrap ${ch.chapter_index + 1}` : ch.round === 0 ? "Genesis" : `R${ch.round}`}
            </span>
            <span className="font-mono text-xs">{ch.round === 0 && ch.epoch === 0 ? `(ID.${ch.id})` : `#${ch.chapter_index}(ID.${ch.id})`}</span>
            <span className={`text-xs ${isOwn ? "text-green-400" : "text-neutral-400"}`}>
              {isOwn ? "You" : shortenAddress(ch.author)}
            </span>
            {badge && (
              <Badge variant="secondary" className={`text-[10px] px-1 py-0 ${badge.className}`}>{badge.label}</Badge>
            )}
            {isOwn && !isAnchor && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-green-900/50 text-green-400 border-green-700">Mine</Badge>
            )}
            {votingRoundId && !isAnchor && (
              <VotedBadge novelId={novelId} votingRoundId={votingRoundId} chapterId={ch.id} />
            )}
            {Number(ch.vote_count) > 0 && !isAnchor && (
              <span className="text-neutral-600 text-xs ml-auto">{ch.vote_count} votes</span>
            )}
          </div>
        </Link>
        {hasChildren && (
          <button
            onClick={(e) => { e.preventDefault(); setCollapsed(prev => !prev); }}
            className="absolute right-1 top-1 hidden group-hover/node:flex items-center gap-1 rounded bg-neutral-800 border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
          >
            {collapsed ? `+ Expand (${countDescendants(ch.id, childrenOf)})` : "- Collapse"}
          </button>
        )}
      </div>
      {!collapsed && children.map((child) => (
        <TreeNode
          key={child.id}
          chapter={child}
          childrenOf={childrenOf}
          depth={depth + 1}
          novelId={novelId}
          votingRoundId={votingRoundId}
          connectedAddress={connectedAddress}
          continuable={continuable}
          activeWorldLineIds={activeWorldLineIds}
        />
      ))}
    </div>
  );
}

// ── Epoch section ─────────────────────────────────────────────────

function EpochSection({ epoch, data, loading, onExpand, novelId, votingRoundId, connectedAddress, continuable, isCurrentEpoch, activeWorldLineIds }: {
  epoch: number;
  data: EpochData | undefined;
  loading: boolean;
  onExpand: () => void;
  novelId: string;
  votingRoundId?: string;
  connectedAddress?: string;
  continuable: boolean;
  isCurrentEpoch: boolean;
  activeWorldLineIds?: Set<string>;
}) {
  // Merge anchors into display chapters
  const allChapters: DisplayChapter[] = [];
  if (data) {
    for (const a of data.anchors) {
      allChapters.push({ ...a, _anchor: true });
    }
    allChapters.push(...data.chapters);
  }

  // Build parent→children map scoped to this epoch's chapters
  const chapterIds = new Set(allChapters.map(c => c.id));
  const childrenOf = new Map<string, DisplayChapter[]>();
  const roots: DisplayChapter[] = [];

  for (const ch of allChapters) {
    if (!ch.parent_id || ch.parent_id === "0" || !chapterIds.has(ch.parent_id)) {
      roots.push(ch);
    } else {
      const list = childrenOf.get(ch.parent_id) || [];
      list.push(ch);
      childrenOf.set(ch.parent_id, list);
    }
  }

  roots.sort((a, b) => Number(a.id) - Number(b.id));
  for (const [, list] of childrenOf) {
    list.sort((a, b) => Number(b.vote_count) - Number(a.vote_count));
  }

  const label = `Epoch ${epoch}`;
  const chapterCount = data ? data.chapters.length : undefined;

  const handleToggle = (e: React.ToggleEvent<HTMLDetailsElement>) => {
    if (e.newState === "open" && !data && !loading) {
      onExpand();
    }
  };

  return (
    <details open={isCurrentEpoch || undefined} onToggle={handleToggle}>
      <summary className="flex items-center gap-3 py-2 cursor-pointer select-none group">
        <div className="h-px flex-1 bg-neutral-800 group-hover:bg-neutral-700 transition-colors" />
        <span className={`text-xs font-medium transition-colors ${
          isCurrentEpoch
            ? "text-amber-500"
            : "text-neutral-500 group-hover:text-neutral-400"
        }`}>
          {label}{chapterCount !== undefined ? ` · ${chapterCount} chapter${chapterCount !== 1 ? "s" : ""}` : ""}
        </span>
        <div className="h-px flex-1 bg-neutral-800 group-hover:bg-neutral-700 transition-colors" />
      </summary>
      {loading && (
        <div className="text-center text-neutral-500 text-xs py-4">Loading...</div>
      )}
      {data && (
        <div className="space-y-1 mt-1">
          {roots.map((root) => (
            <TreeNode
              key={`${root.id}${root._anchor ? "-anchor" : ""}`}
              chapter={root}
              childrenOf={childrenOf}
              depth={0}
              novelId={novelId}
              votingRoundId={votingRoundId}
              connectedAddress={connectedAddress}
              continuable={continuable}
              activeWorldLineIds={activeWorldLineIds}
            />
          ))}
        </div>
      )}
    </details>
  );
}

// ── Main component ────────────────────────────────────────────────

export function StoryTree({ epochData, maxEpoch, loadingEpochs, onExpandEpoch, novelId, votingRoundId, connectedAddress, continuable, activeWorldLineIds }: StoryTreeProps) {
  const epochs = Array.from({ length: maxEpoch }, (_, i) => i + 1);

  return (
    <div className="space-y-1">
      {epochs.map(epoch => (
        <EpochSection
          key={epoch}
          epoch={epoch}
          data={epochData.get(epoch)}
          loading={loadingEpochs.has(epoch)}
          onExpand={() => onExpandEpoch(epoch)}
          novelId={novelId}
          votingRoundId={votingRoundId}
          connectedAddress={connectedAddress}
          continuable={!!continuable}
          isCurrentEpoch={epoch === maxEpoch}
          activeWorldLineIds={activeWorldLineIds}
        />
      ))}
    </div>
  );
}

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { TreeChapter } from "@/lib/api";
import { shortenAddress } from "@/lib/format";
import { VotedBadge } from "@/components/voted-badge";

interface StoryTreeProps {
  chapters: TreeChapter[];
  novelId: string;
  votingRoundId?: string;
  connectedAddress?: string;
  continuable?: boolean;
}

// Chapters injected as epoch anchors carry this flag
type DisplayChapter = TreeChapter & { _anchor?: boolean };

// ── Badge logic ───────────────────────────────────────────────────

function getChapterBadge(ch: TreeChapter, continuable: boolean): { label: string; className: string } | null {
  const isContinuable = continuable && ch.is_world_line;
  if (isContinuable) return { label: "Continue", className: "bg-green-900/60 text-green-300 border-green-700" };
  if (ch.is_canon) return { label: "Canon", className: "bg-amber-900/60 text-amber-300 border-amber-700" };
  if (ch.is_world_line) return { label: "World Line", className: "bg-blue-900/60 text-blue-300 border-blue-700" };
  return null;
}

// ── Recursive tree node (used inside each epoch) ──────────────────

function TreeNode({ chapter: ch, childrenOf, depth, novelId, votingRoundId, connectedAddress, continuable }: {
  chapter: DisplayChapter;
  childrenOf: Map<string, DisplayChapter[]>;
  depth: number;
  novelId: string;
  votingRoundId?: string;
  connectedAddress?: string;
  continuable: boolean;
}) {
  const children = childrenOf.get(ch.id) || [];
  const isOwn = !!connectedAddress && ch.author.toLowerCase() === connectedAddress.toLowerCase();
  const isAnchor = !!ch._anchor;
  const isContinuable = !isAnchor && continuable && ch.is_world_line;
  const badge = isAnchor ? null : getChapterBadge(ch, continuable);

  const borderColor = isAnchor
    ? "border-amber-600 border-dashed bg-amber-950/30"
    : ch.is_canon
      ? "border-amber-600 bg-amber-950/30"
      : ch.is_world_line
        ? "border-blue-700 bg-blue-950/20"
        : "border-neutral-800 bg-neutral-900";

  return (
    <div className={depth > 0 ? "ml-5 border-l border-neutral-800 pl-3" : ""}>
      <Link
        href={`/chapters/${ch.id}`}
        className={`block rounded-lg border p-2 text-sm transition-colors hover:border-neutral-500 mb-1 ${borderColor}`}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          {isAnchor && (
            <span className="text-neutral-600 text-xs italic">from prev epoch ·</span>
          )}
          <span className="text-neutral-500 text-xs">
            {ch.round === 0 ? "Genesis" : `R${ch.round}`}
          </span>
          <span className="font-mono text-xs">#{ch.chapter_index}(ID.{ch.id})</span>
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
      {children.map((child) => (
        <TreeNode
          key={child.id}
          chapter={child}
          childrenOf={childrenOf}
          depth={depth + 1}
          novelId={novelId}
          votingRoundId={votingRoundId}
          connectedAddress={connectedAddress}
          continuable={continuable}
        />
      ))}
    </div>
  );
}

// ── Epoch section ─────────────────────────────────────────────────

function EpochSection({ epoch, chapters, novelId, votingRoundId, connectedAddress, continuable, isCurrentEpoch }: {
  epoch: number;
  chapters: DisplayChapter[];
  novelId: string;
  votingRoundId?: string;
  connectedAddress?: string;
  continuable: boolean;
  isCurrentEpoch: boolean;
}) {
  // Build parent→children map scoped to this epoch's chapters
  const chapterIds = new Set(chapters.map(c => c.id));
  const childrenOf = new Map<string, DisplayChapter[]>();
  const roots: DisplayChapter[] = [];

  for (const ch of chapters) {
    // Root if parent is outside this epoch or is genesis root
    if (!ch.parent_id || ch.parent_id === "0" || !chapterIds.has(ch.parent_id)) {
      roots.push(ch);
    } else {
      const list = childrenOf.get(ch.parent_id) || [];
      list.push(ch);
      childrenOf.set(ch.parent_id, list);
    }
  }

  // Sort roots by id, children by vote_count desc
  roots.sort((a, b) => Number(a.id) - Number(b.id));
  for (const [, list] of childrenOf) {
    list.sort((a, b) => Number(b.vote_count) - Number(a.vote_count));
  }

  const tree = (
    <div className="space-y-1 mt-1">
      {roots.map((root) => (
        <TreeNode
          key={root.id}
          chapter={root}
          childrenOf={childrenOf}
          depth={0}
          novelId={novelId}
          votingRoundId={votingRoundId}
          connectedAddress={connectedAddress}
          continuable={continuable}
        />
      ))}
    </div>
  );

  const label = `Epoch ${epoch}`;
  const chapterCount = chapters.filter(c => !c._anchor).length;

  // Current epoch: open by default
  return (
    <details open={isCurrentEpoch || undefined}>
      <summary className="flex items-center gap-3 py-2 cursor-pointer select-none group">
        <div className="h-px flex-1 bg-neutral-800 group-hover:bg-neutral-700 transition-colors" />
        <span className={`text-xs font-medium transition-colors ${
          isCurrentEpoch
            ? "text-amber-500"
            : "text-neutral-500 group-hover:text-neutral-400"
        }`}>
          {label} · {chapterCount} chapter{chapterCount > 1 ? "s" : ""}
        </span>
        <div className="h-px flex-1 bg-neutral-800 group-hover:bg-neutral-700 transition-colors" />
      </summary>
      {tree}
    </details>
  );
}

// ── Main component ────────────────────────────────────────────────

export function StoryTree({ chapters, novelId, votingRoundId, connectedAddress, continuable }: StoryTreeProps) {
  if (chapters.length === 0) return null;

  // Group chapters by epoch. Genesis (epoch=0) merges into epoch 1.
  const byId = new Map<string, TreeChapter>();
  const epochGroups = new Map<number, DisplayChapter[]>();
  for (const ch of chapters) {
    byId.set(ch.id, ch);
    const epoch = ch.epoch === 0 ? 1 : ch.epoch;
    const list = epochGroups.get(epoch) || [];
    list.push(ch);
    epochGroups.set(epoch, list);
  }

  const sortedEpochs = Array.from(epochGroups.keys()).sort((a, b) => a - b);
  const maxEpoch = sortedEpochs[sortedEpochs.length - 1];

  // For epoch >= 2, inject anchor chapters from previous epoch.
  // Find chapters whose parent_id points outside the current epoch group,
  // then add that parent as a dashed "anchor" node so the tree has a visible root.
  for (const epoch of sortedEpochs) {
    if (epoch <= 1) continue;
    const group = epochGroups.get(epoch)!;
    const groupIds = new Set(group.map(c => c.id));
    const anchorsNeeded = new Set<string>();
    for (const ch of group) {
      if (ch.parent_id && ch.parent_id !== "0" && !groupIds.has(ch.parent_id)) {
        anchorsNeeded.add(ch.parent_id);
      }
    }
    for (const parentId of anchorsNeeded) {
      const parent = byId.get(parentId);
      if (parent) {
        group.unshift({ ...parent, _anchor: true });
        groupIds.add(parent.id);
      }
    }
  }

  return (
    <div className="space-y-1">
      {sortedEpochs.map(epoch => (
        <EpochSection
          key={epoch}
          epoch={epoch}
          chapters={epochGroups.get(epoch)!}
          novelId={novelId}
          votingRoundId={votingRoundId}
          connectedAddress={connectedAddress}
          continuable={!!continuable}
          isCurrentEpoch={epoch === maxEpoch}
        />
      ))}
    </div>
  );
}

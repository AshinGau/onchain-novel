import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { TreeChapter } from "@/lib/api";
import { shortenAddress, timeAgo } from "@/lib/format";
import { VotedBadge } from "@/components/voted-badge";

interface StoryTreeProps {
  chapters: TreeChapter[];
  novelId: string;
  /** Pass votingRoundId to show "My Vote" badges on chapters the user voted for */
  votingRoundId?: string;
  /** Connected wallet address — highlights the user's own chapters */
  connectedAddress?: string;
}

export function StoryTree({ chapters, novelId, votingRoundId, connectedAddress }: StoryTreeProps) {
  // Build parent→children map
  const childrenOf = new Map<string, TreeChapter[]>();
  const roots: TreeChapter[] = [];

  for (const ch of chapters) {
    if (ch.parent_id === "0" || !ch.parent_id) {
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

  return (
    <div className="space-y-1">
      {roots.map((root) => (
        <TreeNode key={root.id} chapter={root} childrenOf={childrenOf} depth={0} novelId={novelId} votingRoundId={votingRoundId} connectedAddress={connectedAddress} />
      ))}
    </div>
  );
}

function TreeNode({ chapter: ch, childrenOf, depth, novelId, votingRoundId, connectedAddress }: {
  chapter: TreeChapter;
  childrenOf: Map<string, TreeChapter[]>;
  depth: number;
  novelId: string;
  votingRoundId?: string;
  connectedAddress?: string;
}) {
  const children = childrenOf.get(ch.id) || [];
  const isOwn = !!connectedAddress && ch.author.toLowerCase() === connectedAddress.toLowerCase();

  return (
    <div className={depth > 0 ? "ml-5 border-l border-neutral-800 pl-3" : ""}>
      <Link
        href={`/chapters/${ch.id}`}
        className={`block rounded-lg border p-2 text-sm transition-colors hover:border-neutral-500 mb-1 ${
          ch.is_canon
            ? "border-amber-600 bg-amber-950/30"
            : ch.is_world_line
              ? "border-blue-700 bg-blue-950/20"
              : "border-neutral-800 bg-neutral-900"
        }`}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-neutral-500 text-xs">
            {ch.round === 0 ? "Genesis" : `R${ch.round}`}
          </span>
          <span className="font-mono text-xs">#{ch.chapter_index}(ID.{ch.id})</span>
          <span className={`text-xs ${isOwn ? "text-green-400" : "text-neutral-400"}`}>
            {isOwn ? "You" : shortenAddress(ch.author)}
          </span>
          {ch.created_at && (
            <span className="text-neutral-600 text-xs">{timeAgo(ch.created_at)}</span>
          )}
          {isOwn && <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-green-900/50 text-green-400 border-green-700">Mine</Badge>}
          {ch.is_canon && <Badge className="text-[10px] px-1 py-0">Canon</Badge>}
          {ch.is_world_line && !ch.is_canon && (
            <Badge variant="secondary" className="text-[10px] px-1 py-0">WL</Badge>
          )}
          {votingRoundId && (
            <VotedBadge novelId={novelId} votingRoundId={votingRoundId} chapterId={ch.id} />
          )}
          {Number(ch.vote_count) > 0 && (
            <span className="text-neutral-600 text-xs ml-auto">{ch.vote_count} votes</span>
          )}
        </div>
      </Link>
      {children.map((child) => (
        <TreeNode key={child.id} chapter={child} childrenOf={childrenOf} depth={depth + 1} novelId={novelId} votingRoundId={votingRoundId} connectedAddress={connectedAddress} />
      ))}
    </div>
  );
}

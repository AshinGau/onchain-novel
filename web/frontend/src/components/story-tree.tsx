import Link from "next/link";
import type { TreeChapter } from "@/lib/api";
import { shortenAddress, timeAgo } from "@/lib/format";
import { VotedBadge } from "@/components/voted-badge";

interface StoryTreeProps {
  chapters: TreeChapter[];
  novelId: string;
  votingRoundId?: string;
  connectedAddress?: string;
}

export function StoryTree({ chapters, novelId, votingRoundId, connectedAddress }: StoryTreeProps) {
  const childrenOf = new Map<string, TreeChapter[]>();
  const roots: TreeChapter[] = [];

  for (const ch of chapters) {
    if (ch.parent_id === "0" || !ch.parent_id) { roots.push(ch); }
    else { const list = childrenOf.get(ch.parent_id) || []; list.push(ch); childrenOf.set(ch.parent_id, list); }
  }
  roots.sort((a, b) => Number(a.id) - Number(b.id));
  for (const [, list] of childrenOf) list.sort((a, b) => Number(b.vote_count) - Number(a.vote_count));

  return (
    <div>
      {roots.map((root) => (
        <TreeNode key={root.id} chapter={root} childrenOf={childrenOf} depth={0} novelId={novelId} votingRoundId={votingRoundId} connectedAddress={connectedAddress} />
      ))}
    </div>
  );
}

function TreeNode({ chapter: ch, childrenOf, depth, novelId, votingRoundId, connectedAddress }: {
  chapter: TreeChapter; childrenOf: Map<string, TreeChapter[]>; depth: number;
  novelId: string; votingRoundId?: string; connectedAddress?: string;
}) {
  const children = childrenOf.get(ch.id) || [];
  const isOwn = !!connectedAddress && ch.author.toLowerCase() === connectedAddress.toLowerCase();

  const borderClass = ch.is_canon ? "border-warning" : ch.is_world_line ? "border-info" : "";

  return (
    <div className={depth > 0 ? "ms-4 border-start ps-2" : ""}>
      <Link href={`/chapters/${ch.id}`}
        className={`d-block card card-body p-2 mb-1 small text-decoration-none ${borderClass}`}>
        <div className="d-flex align-items-center gap-1 flex-wrap">
          <span className="text-body-tertiary">{ch.round === 0 ? "Genesis" : `R${ch.round}`}</span>
          <span className="font-monospace">#{ch.chapter_index}(ID.{ch.id})</span>
          <span className={isOwn ? "text-success" : "text-body-secondary"}>
            {isOwn ? "You" : shortenAddress(ch.author)}
          </span>
          {ch.created_at && <span className="text-body-tertiary">{timeAgo(ch.created_at)}</span>}
          {isOwn && <span className="badge bg-success-subtle text-success border border-success">Mine</span>}
          {ch.is_canon && <span className="badge bg-warning text-dark">Canon</span>}
          {ch.is_world_line && !ch.is_canon && <span className="badge bg-secondary">WL</span>}
          {votingRoundId && <VotedBadge novelId={novelId} votingRoundId={votingRoundId} chapterId={ch.id} />}
          {Number(ch.vote_count) > 0 && <span className="text-body-tertiary ms-auto">{ch.vote_count} votes</span>}
        </div>
      </Link>
      {children.map((child) => (
        <TreeNode key={child.id} chapter={child} childrenOf={childrenOf} depth={depth + 1} novelId={novelId} votingRoundId={votingRoundId} connectedAddress={connectedAddress} />
      ))}
    </div>
  );
}

import Link from "next/link";
import type { Novel } from "@/lib/api";
import { shortAddress, formatBalance, timeAgo } from "@/lib/format";
import { phaseLabel } from "@/lib/config";

export function NovelCard({ novel }: { novel: Novel }) {
  const phase = phaseLabel(novel.round_phase);

  return (
    <Link href={`/novels/${novel.id}`} className="on-link-block">
      <div className="on-card on-card-hover">
        <div className="on-row-between">
          <span className="text-subheading">
            {novel.title || `Novel #${novel.id}`}
          </span>
          <span className={`on-badge ${novel.active ? "badge-active" : "badge-completed"}`}>
            {novel.active ? "Active" : "Completed"}
          </span>
        </div>

        <p className="text-caption">by {shortAddress(novel.creator)}</p>

        {novel.description && (
          <p className="text-caption text-truncate">{novel.description}</p>
        )}

        <div className="on-row-wrap">
          <span className="text-caption">
            Round {novel.current_round} · {phase}
          </span>
          <span className="text-caption">{novel.chapter_count} chapters</span>
          <span className="text-caption">{novel.author_count} authors</span>
          <span className="text-caption">Pool: {formatBalance(novel.pool_balance)}</span>
        </div>

        <span className="text-tiny">{timeAgo(novel.created_at)}</span>
      </div>
    </Link>
  );
}

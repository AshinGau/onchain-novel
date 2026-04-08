import Link from "next/link";
import type { Novel } from "@/lib/api";
import { shortAddress, formatBalance, timeAgo } from "@/lib/format";
import { phaseLabel } from "@/lib/config";

export function NovelCard({ novel }: { novel: Novel }) {
  const phase = phaseLabel(novel.round_phase);

  return (
    <Link
      href={`/novels/${novel.id}`}
      style={{ textDecoration: "none", display: "block" }}
    >
      <div className="v2-card v2-card-hover v2-stack" style={{ gap: "0.75rem" }}>
        <div className="v2-row" style={{ justifyContent: "space-between" }}>
          <span className="text-subheading" style={{ fontSize: "1rem" }}>
            {novel.title || `Novel #${novel.id}`}
          </span>
          <span className={`v2-badge ${novel.active ? "badge-active" : "badge-completed"}`}>
            {novel.active ? "Active" : "Completed"}
          </span>
        </div>

        <p className="text-caption" style={{ margin: 0 }}>
          by {shortAddress(novel.creator)}
        </p>

        {novel.description && (
          <p className="text-caption" style={{
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {novel.description}
          </p>
        )}

        <div className="v2-row" style={{ gap: "1rem", flexWrap: "wrap" }}>
          <span className="text-caption">
            Round {novel.current_round} &middot; {phase}
          </span>
          <span className="text-caption">
            {novel.chapter_count} chapters
          </span>
          <span className="text-caption">
            {novel.author_count} authors
          </span>
          <span className="text-caption">
            Pool: {formatBalance(novel.pool_balance)}
          </span>
        </div>

        <span className="text-muted" style={{ fontSize: "0.75rem" }}>
          {timeAgo(novel.created_at)}
        </span>
      </div>
    </Link>
  );
}

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
          <span className="text-subheading text-truncate">
            {novel.title || `Novel #${novel.id}`}
          </span>
          <span className={`on-badge ${novel.active ? "badge-active" : "badge-completed"}`}>
            {novel.active ? "Active" : "Completed"}
          </span>
        </div>

        <div className="on-row" style={{ gap: "0.75rem", alignItems: "flex-start" }}>
          {novel.cover_uri && (
            <img
              src={novel.cover_uri}
              alt=""
              style={{
                width: "4rem",
                height: "5.6rem",
                objectFit: "cover",
                borderRadius: "0.375rem",
                background: "var(--color-bg-tertiary)",
                flexShrink: 0,
              }}
            />
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="text-caption">
              by {shortAddress(novel.creator)}
              <span className="text-muted" style={{ marginLeft: "0.5rem" }}>{timeAgo(novel.created_at)}</span>
            </p>

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
          </div>
        </div>
      </div>
    </Link>
  );
}

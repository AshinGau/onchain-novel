import Link from "next/link";
import type { Novel } from "@/lib/api";
import { ROUND_PHASES, EPOCH_PHASES } from "@/lib/api";
import { shortenAddress, formatEth, timeAgo } from "@/lib/format";
import { TOKEN_SYMBOL } from "@/lib/config";

export function NovelCard({ novel }: { novel: Novel }) {
  const phase = novel.epoch_phase === 0
    ? ROUND_PHASES[novel.round_phase]
    : `Epoch ${EPOCH_PHASES[novel.epoch_phase]}`;

  return (
    <Link href={`/novels/${novel.id}`} className="text-decoration-none">
      <div className="card h-100">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-start gap-2">
            <div className="min-w-0">
              <h6 className="card-title text-truncate mb-1">{novel.title || `Novel #${novel.id}`}</h6>
              <p className="small text-body-secondary mb-0">{shortenAddress(novel.creator)}</p>
            </div>
            <div className="d-flex flex-column align-items-end gap-1 flex-shrink-0">
              <span className={`badge ${novel.active ? "bg-primary" : "bg-secondary"}`}>
                {novel.active ? phase : "Completed"}
              </span>
              {Number(novel.pool_balance) > 0 && (
                <span className="badge bg-warning text-dark">
                  Pool: {formatEth(novel.pool_balance)} {TOKEN_SYMBOL}
                </span>
              )}
            </div>
          </div>

          {novel.description && (
            <p className="small text-body-secondary mt-2 mb-0 line-clamp-2">{novel.description}</p>
          )}

          <div className="d-flex gap-3 mt-2 small text-body-tertiary">
            <span>{novel.chapter_count ?? 0} chapters</span>
            <span>{novel.author_count ?? 0} authors</span>
            {novel.fork_source_novel_id && <span>Forked from #{novel.fork_source_novel_id}</span>}
            {novel.last_chapter_at && <span>{timeAgo(novel.last_chapter_at)}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Novel } from "@/lib/api";
import { ROUND_PHASES, EPOCH_PHASES } from "@/lib/api";
import { shortenAddress, formatEth, timeAgo } from "@/lib/format";
import { TOKEN_SYMBOL } from "@/lib/config";

export function NovelCard({ novel }: { novel: Novel }) {
  const phase = novel.epoch_phase === 0
    ? ROUND_PHASES[novel.round_phase]
    : `Epoch ${EPOCH_PHASES[novel.epoch_phase]}`;

  return (
    <Link href={`/novels/${novel.id}`} className="block">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold truncate">{novel.title || `Novel #${novel.id}`}</h3>
            <p className="text-sm text-neutral-400 mt-0.5">{shortenAddress(novel.creator)}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge variant={novel.active ? "default" : "secondary"} className="text-xs">
              {novel.active ? phase : "Completed"}
            </Badge>
            {Number(novel.pool_balance) > 0 && (
              <span className="text-xs font-medium text-amber-400">
                Pool: {formatEth(novel.pool_balance)} {TOKEN_SYMBOL}
              </span>
            )}
          </div>
        </div>

        {novel.description && (
          <p className="text-sm text-neutral-400 mt-2 line-clamp-2">{novel.description}</p>
        )}

        <div className="flex items-center gap-4 mt-3 text-xs text-neutral-500">
          <span>{novel.chapter_count ?? 0} chapters</span>
          <span>{novel.author_count ?? 0} authors</span>
          {novel.fork_source_novel_id && (
            <span>Forked from #{novel.fork_source_novel_id}</span>
          )}
          {novel.last_chapter_at && <span>{timeAgo(novel.last_chapter_at)}</span>}
        </div>
      </div>
    </Link>
  );
}

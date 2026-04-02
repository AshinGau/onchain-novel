import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { TreeChapter } from "@/lib/api";
import { shortenAddress } from "@/lib/format";

interface StoryTreeProps {
  chapters: TreeChapter[];
  novelId: string;
}

export function StoryTree({ chapters, novelId }: StoryTreeProps) {
  // Group chapters by round for a simple layered view
  const byRound = new Map<number, TreeChapter[]>();
  for (const ch of chapters) {
    const list = byRound.get(ch.round) || [];
    list.push(ch);
    byRound.set(ch.round, list);
  }

  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      {rounds.map((round) => (
        <div key={round}>
          <p className="text-xs text-neutral-500 mb-1">Round {round}</p>
          <div className="flex flex-wrap gap-2">
            {byRound.get(round)!.map((ch) => (
              <Link
                key={ch.id}
                href={`/chapters/${ch.id}`}
                className={`block rounded-lg border p-2 text-sm transition-colors hover:border-neutral-500 ${
                  ch.is_canon
                    ? "border-amber-600 bg-amber-950/30"
                    : ch.is_world_line
                      ? "border-blue-700 bg-blue-950/20"
                      : "border-neutral-800 bg-neutral-900"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs">#{ch.chapter_index}</span>
                  <span className="text-neutral-400 text-xs">{shortenAddress(ch.author)}</span>
                  {ch.is_canon && <Badge className="text-[10px] px-1 py-0">Canon</Badge>}
                  {ch.is_world_line && !ch.is_canon && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0">WL</Badge>
                  )}
                </div>
                <p className="text-xs text-neutral-500 mt-0.5">{ch.vote_count} votes</p>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

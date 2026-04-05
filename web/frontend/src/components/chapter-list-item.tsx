import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { shortenAddress } from "@/lib/format";

interface ChapterListItemProps {
  id: string;
  author: string;
  vote_count: string;
  is_canon: boolean;
  is_world_line: boolean;
}

export function ChapterListItem({ id, author, vote_count, is_canon, is_world_line }: ChapterListItemProps) {
  return (
    <Link
      href={`/chapters/${id}`}
      className="flex items-center justify-between rounded-md bg-neutral-900 border border-neutral-800 p-2 hover:border-neutral-600 text-sm"
    >
      <span>Candidate(ID.{id}) by {shortenAddress(author)}</span>
      <div className="flex items-center gap-2">
        {Number(vote_count) > 0 && <span className="text-neutral-500">{vote_count} votes</span>}
        {is_canon && <Badge className="bg-amber-600 text-xs">Canon</Badge>}
        {is_world_line && !is_canon && <Badge className="bg-green-700 text-xs">WL</Badge>}
      </div>
    </Link>
  );
}

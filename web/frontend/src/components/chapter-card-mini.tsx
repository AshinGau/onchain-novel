import Link from "next/link";
import type { ChapterSummary } from "@/lib/api";
import { shortAddress } from "@/lib/format";

interface ChapterCardMiniProps {
  chapter: ChapterSummary;
  novelId: string;
  highlight?: boolean;
  showWorldLine?: boolean;
}

export function ChapterCardMini({
  chapter,
  novelId,
  highlight,
  showWorldLine,
}: ChapterCardMiniProps) {
  return (
    <Link
      href={`/novels/${novelId}/chapter/${chapter.id}`}
      style={{ textDecoration: "none", display: "block" }}
    >
      <div
        className="on-card-hover"
        style={{
          padding: "0.5rem 0.75rem",
          borderRadius: "0.5rem",
          border: highlight
            ? "2px solid var(--color-primary)"
            : "1px solid var(--color-border)",
          background: "var(--color-bg)",
          transition: "box-shadow 0.2s",
        }}
      >
        <div className="on-row-between">
          <span style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--color-text)" }}>
            Ch.{chapter.id}
          </span>
          <div className="on-row" style={{ gap: "0.25rem" }}>
            <span className="on-badge badge-depth">d:{chapter.depth}</span>
            {(showWorldLine || chapter.is_world_line) && (
              <span className="on-badge badge-worldline">WL</span>
            )}
          </div>
        </div>
        <span className="text-caption" style={{ fontSize: "0.75rem" }}>
          by {shortAddress(chapter.author)}
        </span>
      </div>
    </Link>
  );
}

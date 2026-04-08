"use client";

import Link from "next/link";
import type { Novel } from "@/lib/api";
import { shortAddress, formatBalance } from "@/lib/format";
import { phaseLabel } from "@/lib/config";

export function NovelInfo({ novel }: { novel: Novel }) {
  const phase = phaseLabel(novel.round_phase);

  return (
    <div className="v2-card v2-stack" style={{ gap: "0.75rem" }}>
      <div className="v2-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h1 className="text-heading" style={{ margin: 0 }}>
          {novel.title || `Novel #${novel.id}`}
        </h1>
        <span className={`v2-badge ${novel.active ? "badge-active" : "badge-completed"}`}>
          {novel.active ? "Active" : "Completed"}
        </span>
      </div>

      {novel.description && (
        <p className="text-body" style={{ margin: 0 }}>
          {novel.description}
        </p>
      )}

      <div className="v2-row" style={{ gap: "1rem", flexWrap: "wrap" }}>
        <span className="text-caption">
          Creator: {shortAddress(novel.creator)}
        </span>
        <span className="text-caption">
          Round {novel.current_round} &middot; {phase}
        </span>
        <span className="text-caption">
          Pool: {formatBalance(novel.pool_balance)}
        </span>
        <span className="text-caption">
          {novel.chapter_count} chapters
        </span>
        <span className="text-caption">
          {novel.author_count} authors
        </span>
        {novel.config?.worldLineCount && (
          <span className="text-caption">
            N={novel.config.worldLineCount} world lines
          </span>
        )}
      </div>

      <div className="v2-row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <Link href={`/novels/${novel.id}/tree`}>
          <button className="v2-btn v2-btn-secondary">Story Tree</button>
        </Link>
      </div>
    </div>
  );
}

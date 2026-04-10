"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Novel } from "@/lib/api";
import { fetchNickname } from "@/lib/api";
import { shortAddress, formatBalance } from "@/lib/format";
import { phaseLabel } from "@/lib/config";

export function NovelInfo({ novel }: { novel: Novel }) {
  const phase = phaseLabel(novel.round_phase);
  const [creatorName, setCreatorName] = useState<string | null>(null);

  useEffect(() => {
    fetchNickname(novel.creator).then(r => {
      if (r.nickname) setCreatorName(r.nickname);
    }).catch(() => {});
  }, [novel.creator]);

  return (
    <div className="on-card on-stack" style={{ gap: "0.75rem" }}>
      <div className="on-row" style={{ gap: "1rem", alignItems: "flex-start" }}>
        {novel.cover_uri && (
          <img
            src={novel.cover_uri}
            alt=""
            style={{
              width: "6rem",
              height: "8rem",
              objectFit: "cover",
              borderRadius: "0.5rem",
              background: "var(--color-bg-tertiary)",
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="on-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <h1 className="text-heading" style={{ margin: 0 }}>
              {novel.title || `Novel #${novel.id}`}
            </h1>
            <span className={`on-badge ${novel.active ? "badge-active" : "badge-completed"}`}>
              {novel.active ? "Active" : "Completed"}
            </span>
          </div>

          {novel.description && (
            <p className="text-body" style={{ margin: 0, marginTop: "0.5rem" }}>
              {novel.description}
            </p>
          )}
        </div>
      </div>

      <div className="on-row" style={{ gap: "1rem", flexWrap: "wrap" }}>
        <span className="text-caption">
          Creator: {creatorName || shortAddress(novel.creator)}
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

      <div className="on-row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <Link href={`/novels/${novel.id}/tree`}>
          <button className="on-btn on-btn-secondary">Story Tree</button>
        </Link>
        <Link href={`/fork/${novel.id}/1`}>
          <button className="on-btn on-btn-secondary">Fork Novel</button>
        </Link>
      </div>
    </div>
  );
}

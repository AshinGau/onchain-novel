"use client";

import { useEffect, useRef, useState } from "react";

import { ChainColumn } from "@/components/chain-column";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchNovelLines, type LineMode, type NovelLine } from "@/lib/api";

interface Props {
  novelId: string;
  initialMode: LineMode;
  initialLines: NovelLine[];
}

const MODES: { value: LineMode; label: string; hint: string }[] = [
  { value: "longest", label: "Longest", hint: "Deepest chains under each canon ancestor" },
  { value: "canon", label: "Canon", hint: "Contract's current world-line ancestors (next round's bases)" },
  { value: "active", label: "Active", hint: "Most recently updated leaf chapters" },
  { value: "funded", label: "Most Funded", hint: "Leaves with the most chapter tips" },
];

// Unified column heading across all modes — the active mode is already
// indicated by the highlighted button above, so a per-mode prefix would be
// redundant and visually fragmented.
function columnLabel(_mode: LineMode, index: number): string {
  return `Story Line ${index}`;
}

// Pick the deepest WL ancestor present in the chain so ChainColumn can render
// the same root → ... → WL → ... → leaf layout regardless of which mode
// produced the chain.
function findWorldLineAncestor(chain: NovelLine["chain"]): string {
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].is_world_line) return chain[i].id;
  }
  return "";
}

export function NovelWorldlines({ novelId, initialMode, initialLines }: Props) {
  const [mode, setMode] = useState<LineMode>(initialMode);
  const [lines, setLines] = useState<NovelLine[]>(initialLines);
  const [loading, setLoading] = useState(false);
  // Skip the very first effect run — initialLines is already populated from
  // the server, no need to refetch. Every subsequent mode change refetches,
  // including switching back to the initial mode.
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchNovelLines(novelId, mode)
      .then((data) => {
        if (!cancelled) setLines(data.lines);
      })
      .catch(() => {
        if (!cancelled) setLines([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, novelId]);

  const activeMode = MODES.find((m) => m.value === mode);

  return (
    <div className="on-stack" style={{ gap: "1rem" }}>
      {/* Mode selector */}
      <div className="on-row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => setMode(m.value)}
            className={mode === m.value ? "on-btn on-btn-primary" : "on-btn on-btn-secondary"}
            style={{ padding: "0.35rem 0.85rem", fontSize: "0.85rem" }}
          >
            {m.label}
          </button>
        ))}
        {activeMode && (
          <span className="text-caption text-muted" style={{ marginLeft: "0.5rem" }}>
            {activeMode.hint}
          </span>
        )}
      </div>

      {/* Stale-while-revalidate: keep rendering the previous `lines` while a
          new fetch is in flight so the page height doesn't collapse and the
          scroll position stays put. Only show "empty" when we truly have none
          and aren't loading. */}
      {!loading && lines.length === 0 && (
        <div className="text-caption" style={{ textAlign: "center", padding: "2rem" }}>
          No story lines available for this mode.
        </div>
      )}

      {lines.length > 0 && (
        <div
          style={{
            opacity: loading ? 0.5 : 1,
            pointerEvents: loading ? "none" : "auto",
            transition: "opacity 0.15s",
          }}
          aria-busy={loading}
        >
          {/* Desktop: multi-column grid */}
          <div className="worldline-grid-desktop">
            <div
              className="on-grid"
              style={{ "--cols": Math.min(lines.length, 4) } as React.CSSProperties}
            >
              {lines.map((ln, i) => (
                <ChainColumn
                  key={ln.leafId}
                  worldlineIndex={i + 1}
                  chain={ln.chain}
                  worldlineAncestorId={findWorldLineAncestor(ln.chain)}
                  novelId={novelId}
                  label={columnLabel(mode, i + 1)}
                />
              ))}
            </div>
          </div>

          {/* Mobile: tab-based. Key by mode so the Tabs primitive re-mounts on
              mode change — otherwise its uncontrolled internal "active tab" can
              point at an index that no longer exists (e.g. "1" when only "0" is
              left), leaving the panel blank. */}
          <div className="worldline-tabs-mobile">
            <Tabs key={mode} defaultValue="0">
              <TabsList>
                {lines.map((_, i) => (
                  <TabsTrigger key={i} value={String(i)}>
                    {columnLabel(mode, i + 1)}
                  </TabsTrigger>
                ))}
              </TabsList>
              {lines.map((ln, i) => (
                <TabsContent key={i} value={String(i)}>
                  <ChainColumn
                    worldlineIndex={i + 1}
                    chain={ln.chain}
                    worldlineAncestorId={
                      mode === "canon" || mode === "longest" ? ln.ancestorId : ""
                    }
                    novelId={novelId}
                    label={columnLabel(mode, i + 1)}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </div>
      )}

      <style>{`
        .worldline-tabs-mobile { display: none; }
        @media (max-width: 639px) {
          .worldline-grid-desktop { display: none; }
          .worldline-tabs-mobile { display: block; }
        }
      `}</style>
    </div>
  );
}

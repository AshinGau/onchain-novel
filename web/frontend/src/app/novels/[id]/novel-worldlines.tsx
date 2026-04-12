"use client";

import { useMemo, useState } from "react";
import type { ChapterSummary } from "@/lib/api";
import { ChainColumn } from "@/components/chain-column";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { buildTree, findDeepestLeaf, getChainToNode, type TreeNode } from "@/hooks/use-novel";

interface Props {
  novelId: string;
  chapters: ChapterSummary[];
  worldlines: ChapterSummary[];
}

interface WorldlineData {
  worldline: ChapterSummary;
  chain: ChapterSummary[];
  leafId: string;
  otherBranches: ChapterSummary[][];
}

export function NovelWorldlines({ novelId, chapters, worldlines }: Props) {
  const tree = useMemo(() => buildTree(chapters), [chapters]);

  const worldlineData = useMemo<WorldlineData[]>(() => {
    if (!tree || worldlines.length === 0) return [];

    // Build a lookup map for tree nodes
    const nodeMap = new Map<string, TreeNode>();
    function indexNodes(node: TreeNode) {
      nodeMap.set(node.chapter.id, node);
      for (const child of node.children) indexNodes(child);
    }
    indexNodes(tree);

    return worldlines.map((wl) => {
      const wlNode = nodeMap.get(wl.id);
      if (!wlNode) {
        return { worldline: wl, chain: [wl], leafId: wl.id, otherBranches: [] };
      }

      // Find deepest leaf from the worldline ancestor
      const deepestLeaf = findDeepestLeaf(wlNode);
      // Get the full chain from root to this leaf
      const chain = getChainToNode(tree, deepestLeaf.chapter.id);

      // Find other branches: all leaves from wlNode except the main chain
      const otherBranches: ChapterSummary[][] = [];
      function collectBranches(node: TreeNode, currentPath: ChapterSummary[]) {
        const path = [...currentPath, node.chapter];
        if (node.children.length === 0 && node.chapter.id !== deepestLeaf.chapter.id) {
          otherBranches.push(path);
        }
        for (const child of node.children) {
          collectBranches(child, path);
        }
      }
      for (const child of wlNode.children) {
        collectBranches(child, [wlNode.chapter]);
      }

      return {
        worldline: wl,
        chain,
        leafId: deepestLeaf.chapter.id,
        otherBranches,
      };
    });
  }, [tree, worldlines]);

  if (worldlineData.length === 0) {
    return (
      <div className="text-caption" style={{ textAlign: "center", padding: "2rem" }}>
        No world lines yet. Start writing to create the story!
      </div>
    );
  }

  return (
    <div>
      {/* Desktop: multi-column grid */}
      <div className="worldline-grid-desktop">
        <div
          className="on-grid"
          style={{ "--cols": Math.min(worldlineData.length, 4) } as React.CSSProperties}
        >
          {worldlineData.map((wld, i) => (
            <ChainColumn
              key={wld.worldline.id}
              worldlineIndex={i + 1}
              chain={wld.chain}
              worldlineAncestorId={wld.worldline.id}
              novelId={novelId}
            />
          ))}
        </div>

        {/* Other branches section */}
        {worldlineData.some((wld) => wld.otherBranches.length > 0) && (
          <OtherBranches data={worldlineData} novelId={novelId} />
        )}
      </div>

      {/* Mobile: tab-based */}
      <div className="worldline-tabs-mobile">
        <Tabs defaultValue="0">
          <TabsList>
            {worldlineData.map((_, i) => (
              <TabsTrigger key={i} value={String(i)}>
                WL {i + 1}
              </TabsTrigger>
            ))}
          </TabsList>
          {worldlineData.map((wld, i) => (
            <TabsContent key={i} value={String(i)}>
              <ChainColumn
                worldlineIndex={i + 1}
                chain={wld.chain}
                worldlineAncestorId={wld.worldline.id}
                novelId={novelId}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

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

function OtherBranches({ data, novelId }: { data: WorldlineData[]; novelId: string }) {
  const [expanded, setExpanded] = useState(false);

  const totalBranches = data.reduce((sum, wld) => sum + wld.otherBranches.length, 0);
  if (totalBranches === 0) return null;

  return (
    <div className="on-card" style={{ marginTop: "1rem" }}>
      <button
        className="on-btn on-btn-ghost"
        onClick={() => setExpanded(!expanded)}
        style={{ width: "100%" }}
      >
        Other branches ({totalBranches}) {expanded ? "▲" : "▼"}
      </button>
      {expanded && (
        <div className="on-stack" style={{ gap: "0.5rem", marginTop: "0.75rem" }}>
          {data.map((wld, wlIdx) =>
            wld.otherBranches.map((branch, brIdx) => {
              const first = branch[0];
              const last = branch[branch.length - 1];
              return (
                <div key={`${wlIdx}-${brIdx}`} className="on-row-between">
                  <span className="text-caption">
                    ID.{first.id}
                    {branch.length > 2
                      ? ` → ... ${branch.length - 2} chapter${branch.length - 2 !== 1 ? "s" : ""} ... → `
                      : branch.length === 2
                      ? " → "
                      : ""}
                    {branch.length > 1 ? `ID.${last.id}` : ""}
                  </span>
                  <a
                    href={`/novels/${novelId}/read/${last.id}`}
                    className="on-btn on-btn-secondary"
                    style={{ textDecoration: "none", padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
                  >
                    Read
                  </a>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

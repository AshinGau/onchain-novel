"use client";

import { useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { ChapterSummary } from "@/lib/api";
import { shortAddress } from "@/lib/format";

// Dynamically import react-d3-tree to avoid SSR issues
const Tree = dynamic(() => import("react-d3-tree").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="text-caption" style={{ textAlign: "center", padding: "2rem" }}>
      Loading tree...
    </div>
  ),
});

interface StoryTreeProps {
  chapters: ChapterSummary[];
  novelId: string;
}

interface D3TreeNode {
  name: string;
  attributes?: Record<string, string | number | boolean>;
  children?: D3TreeNode[];
  __chapterId?: string;
  __isWorldLine?: boolean;
}

export function StoryTree({ chapters, novelId }: StoryTreeProps) {
  const router = useRouter();

  const treeData = useMemo(() => {
    return buildD3Tree(chapters);
  }, [chapters]);

  const handleNodeClick = useCallback(
    (nodeData: D3TreeNode) => {
      if (nodeData.__chapterId) {
        router.push(`/novels/${novelId}/chapter/${nodeData.__chapterId}`);
      }
    },
    [novelId, router]
  );

  if (!treeData) {
    return (
      <div className="text-caption" style={{ textAlign: "center", padding: "2rem" }}>
        No chapters to display
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "600px" }}>
      <Tree
        data={treeData}
        orientation="vertical"
        pathFunc="step"
        translate={{ x: 400, y: 50 }}
        nodeSize={{ x: 200, y: 100 }}
        separation={{ siblings: 1.2, nonSiblings: 1.5 }}
        renderCustomNodeElement={(rd3tProps) => (
          <CustomNode
            nodeDatum={rd3tProps.nodeDatum as unknown as D3TreeNode}
            onNodeClick={handleNodeClick}
          />
        )}
        zoom={0.8}
        enableLegacyTransitions={false}
      />
    </div>
  );
}

function CustomNode({
  nodeDatum,
  onNodeClick,
}: {
  nodeDatum: D3TreeNode;
  onNodeClick: (node: D3TreeNode) => void;
}) {
  const isWl = nodeDatum.__isWorldLine;

  return (
    <g onClick={() => onNodeClick(nodeDatum)} style={{ cursor: "pointer" }}>
      <rect
        x={-80}
        y={-30}
        width={160}
        height={60}
        rx={8}
        className={isWl ? "tree-node tree-node-worldline" : "tree-node"}
      />
      <text
        x={0}
        y={-10}
        textAnchor="middle"
        style={{
          fontSize: "12px",
          fontWeight: 600,
          fill: "var(--color-text)",
        }}
      >
        {nodeDatum.name}
      </text>
      {nodeDatum.attributes?.author && (
        <text
          x={0}
          y={6}
          textAnchor="middle"
          style={{
            fontSize: "10px",
            fill: "var(--color-text-secondary)",
          }}
        >
          by {nodeDatum.attributes.author}
        </text>
      )}
      {nodeDatum.attributes?.depth && (
        <text
          x={0}
          y={20}
          textAnchor="middle"
          style={{
            fontSize: "10px",
            fill: "var(--color-text-muted)",
          }}
        >
          depth: {nodeDatum.attributes.depth}
        </text>
      )}
    </g>
  );
}

function buildD3Tree(chapters: ChapterSummary[]): D3TreeNode | null {
  if (chapters.length === 0) return null;

  const map = new Map<string, D3TreeNode>();
  let root: D3TreeNode | null = null;

  for (const ch of chapters) {
    map.set(ch.id, {
      name: `Ch.${ch.id}`,
      attributes: {
        author: shortAddress(ch.author),
        depth: String(ch.depth),
      },
      children: [],
      __chapterId: ch.id,
      __isWorldLine: ch.is_world_line,
    });
  }

  for (const ch of chapters) {
    const node = map.get(ch.id)!;
    if (ch.parent_id === "0" || !map.has(ch.parent_id)) {
      root = node;
    } else {
      map.get(ch.parent_id)!.children!.push(node);
    }
  }

  return root;
}

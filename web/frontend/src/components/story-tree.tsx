"use client";

import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ChapterSummary } from "@/lib/api";
import { shortAddress, timeAgo } from "@/lib/format";

interface StoryTreeProps {
  chapters: ChapterSummary[];
  novelId: string;
  hasMore?: boolean;
  maxDepth?: number;
  loading?: boolean;
  onLoadMore?: () => void;
}

interface TreeNode {
  id: string;
  chapter: ChapterSummary;
  children: TreeNode[];
  x: number;
  y: number;
  width: number;
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 72;
const H_GAP = 24;
const V_GAP = 40;
const PADDING = 40;

export function StoryTree({ chapters, novelId, hasMore, maxDepth, loading, onLoadMore }: StoryTreeProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  }, []);

  const { root, totalWidth, totalHeight } = useMemo(() => {
    return layoutTree(chapters);
  }, [chapters]);

  // Center the tree only on first mount
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!containerRef.current || !root || initializedRef.current) return;
    initializedRef.current = true;
    const rect = containerRef.current.getBoundingClientRect();
    setTransform({
      x: Math.max(0, (rect.width - totalWidth) / 2),
      y: PADDING,
      scale: Math.min(1, (rect.width - PADDING * 2) / totalWidth),
    });
  }, [root, totalWidth, totalHeight]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.2, Math.min(2.5, transform.scale * delta));
    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setTransform(prev => ({
      x: mx - (mx - prev.x) * (newScale / prev.scale),
      y: my - (my - prev.y) * (newScale / prev.scale),
      scale: newScale,
    }));
  }, [transform.scale]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setTransform(prev => ({
      ...prev,
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    }));
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  if (!root) {
    return <div className="text-caption on-text-center" style={{ padding: "2rem" }}>No chapters to display</div>;
  }

  return (
    <div
      ref={containerRef}
      className="story-tree-container"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Toolbar */}
      <div style={{
        position: "absolute", top: "0.5rem", right: "0.5rem", zIndex: 10,
        display: "flex", gap: "0.5rem", alignItems: "center",
      }}>
        {hasMore && onLoadMore && (
          <>
            <span className="text-tiny" style={{ color: "var(--color-text-muted)" }}>
              Depth 1–{maxDepth}
            </span>
            <button
              type="button"
              className="on-btn on-btn-secondary"
              onClick={onLoadMore}
              disabled={loading}
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
            >
              {loading ? "Loading..." : "Load deeper"}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          style={{
            width: "2rem", height: "2rem", borderRadius: "0.375rem",
            border: "1px solid var(--color-border)", background: "var(--color-bg)",
            color: "var(--color-text-muted)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1rem", lineHeight: 1,
          }}
        >
          {isFullscreen ? "⊡" : "⛶"}
        </button>
      </div>
      <svg
        width="100%"
        height="100%"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
      >
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* Edges */}
          {renderEdges(root)}
          {/* Nodes */}
          {renderNodes(root, novelId, router, hoveredId, setHoveredId)}
        </g>
      </svg>
    </div>
  );
}

function renderEdges(node: TreeNode): React.ReactNode[] {
  const edges: React.ReactNode[] = [];
  for (const child of node.children) {
    const x1 = node.x + NODE_WIDTH / 2;
    const y1 = node.y + NODE_HEIGHT;
    const x2 = child.x + NODE_WIDTH / 2;
    const y2 = child.y;
    const midY = (y1 + y2) / 2;

    edges.push(
      <path
        key={`edge-${node.id}-${child.id}`}
        d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={2}
        opacity={0.6}
      />
    );
    edges.push(...renderEdges(child));
  }
  return edges;
}

function renderNodes(
  node: TreeNode,
  novelId: string,
  router: ReturnType<typeof useRouter>,
  hoveredId: string | null,
  setHoveredId: (id: string | null) => void,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const isWl = node.chapter.is_world_line;
  const isHovered = hoveredId === node.id;

  const bgColor = isWl ? "var(--color-primary)" : "var(--color-bg)";
  const textColor = isWl ? "white" : "var(--color-text)";
  const borderColor = isHovered
    ? "var(--color-primary)"
    : isWl ? "var(--color-primary)" : "var(--color-border)";
  const shadowOpacity = isHovered ? 0.15 : 0;

  nodes.push(
    <g
      key={`node-${node.id}`}
      style={{ cursor: "pointer" }}
      onClick={(e) => { e.stopPropagation(); router.push(`/novels/${novelId}/chapter/${node.id}`); }}
      onMouseEnter={() => setHoveredId(node.id)}
      onMouseLeave={() => setHoveredId(null)}
    >
      {/* Shadow */}
      <rect
        x={node.x - 2}
        y={node.y + 2}
        width={NODE_WIDTH + 4}
        height={NODE_HEIGHT}
        rx={10}
        fill="black"
        opacity={shadowOpacity}
        style={{ transition: "opacity 0.15s" }}
      />
      {/* Card */}
      <rect
        x={node.x}
        y={node.y}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={10}
        fill={bgColor}
        stroke={borderColor}
        strokeWidth={isWl ? 2.5 : 1.5}
        style={{ transition: "stroke 0.15s, transform 0.15s" }}
      />
      {/* Chapter ID */}
      <text
        x={node.x + 12}
        y={node.y + 22}
        style={{
          fontSize: "13px",
          fontWeight: 700,
          fill: textColor,
          fontFamily: "var(--font-sans)",
        }}
      >
        Ch.{node.id}
      </text>
      {/* Depth badge */}
      <rect
        x={node.x + NODE_WIDTH - 44}
        y={node.y + 8}
        width={32}
        height={20}
        rx={10}
        fill={isWl ? "rgba(255,255,255,0.2)" : "var(--color-bg-tertiary)"}
      />
      <text
        x={node.x + NODE_WIDTH - 28}
        y={node.y + 22}
        textAnchor="middle"
        style={{
          fontSize: "10px",
          fontWeight: 600,
          fill: isWl ? "rgba(255,255,255,0.9)" : "var(--color-text-muted)",
          fontFamily: "var(--font-sans)",
        }}
      >
        d:{node.chapter.depth}
      </text>
      {/* Author */}
      <text
        x={node.x + 12}
        y={node.y + 40}
        style={{
          fontSize: "11px",
          fill: isWl ? "rgba(255,255,255,0.75)" : "var(--color-text-secondary)",
          fontFamily: "var(--font-sans)",
        }}
      >
        {shortAddress(node.chapter.author)}
      </text>
      {/* Timestamp */}
      <text
        x={node.x + 12}
        y={node.y + 56}
        style={{
          fontSize: "10px",
          fill: isWl ? "rgba(255,255,255,0.5)" : "var(--color-text-muted)",
          fontFamily: "var(--font-sans)",
        }}
      >
        {timeAgo(node.chapter.timestamp)}
      </text>
      {/* WL indicator dot */}
      {isWl && (
        <circle
          cx={node.x + NODE_WIDTH - 12}
          cy={node.y + NODE_HEIGHT - 12}
          r={4}
          fill="white"
          opacity={0.6}
        />
      )}
    </g>
  );

  for (const child of node.children) {
    nodes.push(...renderNodes(child, novelId, router, hoveredId, setHoveredId));
  }

  return nodes;
}

function layoutTree(chapters: ChapterSummary[]): { root: TreeNode | null; totalWidth: number; totalHeight: number } {
  if (chapters.length === 0) return { root: null, totalWidth: 0, totalHeight: 0 };

  // Build tree structure
  const nodeMap = new Map<string, TreeNode>();
  let root: TreeNode | null = null;

  for (const ch of chapters) {
    nodeMap.set(ch.id, {
      id: ch.id,
      chapter: ch,
      children: [],
      x: 0,
      y: 0,
      width: NODE_WIDTH,
    });
  }

  for (const ch of chapters) {
    const node = nodeMap.get(ch.id)!;
    if (ch.parent_id === "0" || !nodeMap.has(ch.parent_id)) {
      root = node;
    } else {
      nodeMap.get(ch.parent_id)!.children.push(node);
    }
  }

  if (!root) return { root: null, totalWidth: 0, totalHeight: 0 };

  // Sort children by id for consistent layout
  function sortChildren(node: TreeNode) {
    node.children.sort((a, b) => Number(a.id) - Number(b.id));
    for (const child of node.children) sortChildren(child);
  }
  sortChildren(root);

  // Calculate subtree widths bottom-up
  function calcWidth(node: TreeNode): number {
    if (node.children.length === 0) return NODE_WIDTH;
    const childWidths = node.children.map(calcWidth);
    const totalChildWidth = childWidths.reduce((sum, w) => sum + w, 0) + (node.children.length - 1) * H_GAP;
    return Math.max(NODE_WIDTH, totalChildWidth);
  }

  const treeWidth = calcWidth(root);

  // Position nodes
  function position(node: TreeNode, x: number, y: number) {
    node.y = y;

    if (node.children.length === 0) {
      node.x = x;
      return;
    }

    const childWidths = node.children.map(calcWidth);
    const totalChildWidth = childWidths.reduce((sum, w) => sum + w, 0) + (node.children.length - 1) * H_GAP;

    // Center this node above its children
    node.x = x + (totalChildWidth - NODE_WIDTH) / 2;

    let cx = x;
    for (let i = 0; i < node.children.length; i++) {
      position(node.children[i], cx, y + NODE_HEIGHT + V_GAP);
      cx += childWidths[i] + H_GAP;
    }
  }

  position(root, PADDING, PADDING);

  // Calculate total dimensions
  let maxX = 0;
  let maxY = 0;
  function measure(node: TreeNode) {
    maxX = Math.max(maxX, node.x + NODE_WIDTH);
    maxY = Math.max(maxY, node.y + NODE_HEIGHT);
    for (const child of node.children) measure(child);
  }
  measure(root);

  return { root, totalWidth: maxX + PADDING, totalHeight: maxY + PADDING };
}

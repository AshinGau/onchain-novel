"use client";

import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ChapterSummary } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useNicknames } from "@/hooks/use-nickname";
import { getReadSet } from "@/lib/reading-storage";

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
  const displayName = useNicknames(chapters.map((c) => c.author));
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Hydrate read set on the client to avoid SSR mismatch
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  useEffect(() => { setReadSet(getReadSet()); }, []);

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

  const nodeIndex = useMemo(() => {
    const m = new Map<string, TreeNode>();
    if (root) {
      function walk(n: TreeNode) {
        m.set(n.id, n);
        for (const c of n.children) walk(c);
      }
      walk(root);
    }
    return m;
  }, [root]);

  const selectedNode = selectedId ? nodeIndex.get(selectedId) ?? null : null;

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

  // Touch: 1 finger pan, 2 fingers pinch-zoom
  const touchRef = useRef<{
    mode: "pan" | "pinch" | null;
    startX: number; startY: number;
    initialDist: number; initialScale: number;
    midX: number; midY: number;
    initialTx: number; initialTy: number;
  }>({ mode: null, startX: 0, startY: 0, initialDist: 0, initialScale: 1, midX: 0, midY: 0, initialTx: 0, initialTy: 0 });

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchRef.current = {
        ...touchRef.current,
        mode: "pan",
        startX: t.clientX - transform.x,
        startY: t.clientY - transform.y,
      };
    } else if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dx = b.clientX - a.clientX;
      const dy = b.clientY - a.clientY;
      touchRef.current = {
        mode: "pinch",
        startX: 0, startY: 0,
        initialDist: Math.hypot(dx, dy),
        initialScale: transform.scale,
        midX: (a.clientX + b.clientX) / 2 - rect.left,
        midY: (a.clientY + b.clientY) / 2 - rect.top,
        initialTx: transform.x,
        initialTy: transform.y,
      };
    }
  }, [transform]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const ref = touchRef.current;
    if (ref.mode === "pan" && e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      setTransform(prev => ({ ...prev, x: t.clientX - ref.startX, y: t.clientY - ref.startY }));
    } else if (ref.mode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const newScale = Math.max(0.2, Math.min(2.5, ref.initialScale * (dist / ref.initialDist)));
      const k = newScale / ref.initialScale;
      setTransform({
        scale: newScale,
        x: ref.midX - (ref.midX - ref.initialTx) * k,
        y: ref.midY - (ref.midY - ref.initialTy) * k,
      });
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      touchRef.current.mode = null;
    } else if (e.touches.length === 1 && touchRef.current.mode === "pinch") {
      // Downgrade pinch → pan
      const t = e.touches[0];
      touchRef.current = {
        ...touchRef.current,
        mode: "pan",
        startX: t.clientX - transform.x,
        startY: t.clientY - transform.y,
      };
    }
  }, [transform]);

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
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
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

      {/* Selected action panel */}
      {selectedNode && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: "3rem",
            right: "0.5rem",
            zIndex: 10,
            width: "10rem",
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            padding: "0.75rem",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}
        >
          <div className="on-row-between" style={{ marginBottom: "0.5rem", alignItems: "center" }}>
            <span className="text-caption" style={{ fontWeight: 600 }}>
              ID.{selectedNode.id} <span className="text-muted" style={{ fontWeight: 400 }}>#{selectedNode.chapter.depth}</span>
            </span>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close"
              style={{
                width: "1.5rem", height: "1.5rem",
                background: "transparent", border: "none", cursor: "pointer",
                color: "var(--color-text-muted)", fontSize: "1rem",
              }}
            >×</button>
          </div>
          <div className="on-stack" style={{ gap: "0.375rem" }}>
            <Link
              href={`/novels/${novelId}/chapter/${selectedNode.id}`}
              style={{ textDecoration: "none" }}
            >
              <button type="button" className="on-btn on-btn-secondary" style={{ width: "100%" }}>
                Enter chapter
              </button>
            </Link>
            <button
              type="button"
              className="on-btn on-btn-primary"
              style={{ width: "100%" }}
              onClick={() => {
                const leaf = findDeepestDescendant(selectedNode);
                const chain = chainFromRoot(root!, leaf.id);
                let startIdx = 0;
                for (let i = chain.length - 1; i >= 0; i--) {
                  if (readSet.has(chain[i].id)) { startIdx = i; break; }
                }
                router.push(`/novels/${novelId}/read/${leaf.id}?depth=${startIdx + 1}`);
              }}
            >
              Read storyline
            </button>
          </div>
        </div>
      )}

      <svg
        width="100%"
        height="100%"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
      >
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* Edges */}
          {renderEdges(root)}
          {/* Nodes */}
          {renderNodes(root, hoveredId, setHoveredId, selectedId, setSelectedId, readSet, displayName)}
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
  hoveredId: string | null,
  setHoveredId: (id: string | null) => void,
  selectedId: string | null,
  setSelectedId: (id: string | null) => void,
  readSet: Set<string>,
  displayName: (addr: string) => string,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const isWl = node.chapter.is_world_line;
  const isHovered = hoveredId === node.id;
  const isSelected = selectedId === node.id;
  const isRead = !isWl && readSet.has(node.id);

  const bgColor = isWl ? "var(--color-primary)" : "var(--color-bg)";
  const textColor = isWl ? "white" : "var(--color-text)";
  const borderColor = isSelected
    ? "var(--color-warning)"
    : isHovered
      ? "var(--color-primary)"
      : isWl || isRead
        ? "var(--color-primary)"
        : "var(--color-border)";
  const strokeWidth = isSelected ? 3 : isWl ? 2.5 : isRead ? 2 : 1.5;
  const shadowOpacity = isHovered || isSelected ? 0.15 : 0;

  nodes.push(
    <g
      key={`node-${node.id}`}
      style={{ cursor: "pointer" }}
      onClick={(e) => {
        e.stopPropagation();
        setSelectedId(selectedId === node.id ? null : node.id);
      }}
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
        strokeWidth={strokeWidth}
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
        ID.{node.id}
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
        #{node.chapter.depth}
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
        by {displayName(node.chapter.author)}
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
    nodes.push(...renderNodes(child, hoveredId, setHoveredId, selectedId, setSelectedId, readSet, displayName));
  }

  return nodes;
}

/** Walk down from a node, always taking the deepest branch, return leaf. */
function findDeepestDescendant(node: TreeNode): TreeNode {
  function depth(n: TreeNode): number {
    if (n.children.length === 0) return 1;
    return 1 + Math.max(...n.children.map(depth));
  }
  let current = node;
  while (current.children.length > 0) {
    let best = current.children[0];
    let bestDepth = depth(best);
    for (let i = 1; i < current.children.length; i++) {
      const d = depth(current.children[i]);
      if (d > bestDepth) { best = current.children[i]; bestDepth = d; }
    }
    current = best;
  }
  return current;
}

/** Return chain of nodes from tree root to the node whose id matches `targetId`. */
function chainFromRoot(root: TreeNode, targetId: string): TreeNode[] {
  const path: TreeNode[] = [];
  function dfs(n: TreeNode): boolean {
    path.push(n);
    if (n.id === targetId) return true;
    for (const c of n.children) if (dfs(c)) return true;
    path.pop();
    return false;
  }
  dfs(root);
  return path;
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

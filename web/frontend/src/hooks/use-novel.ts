"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchNovel,
  fetchNovelTree,
  fetchWorldlines,
  fetchRound,
  type Novel,
  type ChapterSummary,
} from "@/lib/api";

/** Fetch a single novel detail */
export function useNovel(id: string) {
  return useQuery<Novel>({
    queryKey: ["novel", id],
    queryFn: () => fetchNovel(id),
    enabled: !!id,
  });
}

/** Fetch the full chapter tree of a novel */
export function useNovelTree(id: string) {
  return useQuery({
    queryKey: ["novel-tree", id],
    queryFn: async () => {
      const { chapters } = await fetchNovelTree(id);
      return chapters;
    },
    enabled: !!id,
  });
}

/** Fetch world line ancestors */
export function useWorldlines(id: string) {
  return useQuery({
    queryKey: ["worldlines", id],
    queryFn: async () => {
      const { worldlines } = await fetchWorldlines(id);
      return worldlines;
    },
    enabled: !!id,
  });
}

/** Fetch round data */
export function useRound(novelId: string, round: number) {
  return useQuery({
    queryKey: ["round", novelId, round],
    queryFn: () => fetchRound(novelId, round),
    enabled: !!novelId && round > 0,
  });
}

/* ============================================================
   Tree computation helpers
   ============================================================ */

export interface TreeNode {
  chapter: ChapterSummary;
  children: TreeNode[];
}

/** Build a tree from flat chapter list */
export function buildTree(chapters: ChapterSummary[]): TreeNode | null {
  if (chapters.length === 0) return null;

  const map = new Map<string, TreeNode>();
  let root: TreeNode | null = null;

  for (const ch of chapters) {
    map.set(ch.id, { chapter: ch, children: [] });
  }

  for (const ch of chapters) {
    const node = map.get(ch.id)!;
    if (ch.parent_id === "0" || !map.has(ch.parent_id)) {
      root = node;
    } else {
      map.get(ch.parent_id)!.children.push(node);
    }
  }

  return root;
}

/** Find the deepest leaf from a given node via DFS */
export function findDeepestLeaf(node: TreeNode): TreeNode {
  if (node.children.length === 0) return node;
  let deepest = node;
  let maxDepth = node.chapter.depth;
  const stack: TreeNode[] = [...node.children];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.chapter.depth > maxDepth) {
      maxDepth = current.chapter.depth;
      deepest = current;
    }
    for (const child of current.children) {
      stack.push(child);
    }
  }
  return deepest;
}

/** Get the chain (path) from root to a specific node */
export function getChainToNode(
  root: TreeNode,
  targetId: string
): ChapterSummary[] {
  const path: ChapterSummary[] = [];

  function dfs(node: TreeNode): boolean {
    path.push(node.chapter);
    if (node.chapter.id === targetId) return true;
    for (const child of node.children) {
      if (dfs(child)) return true;
    }
    path.pop();
    return false;
  }

  dfs(root);
  return path;
}

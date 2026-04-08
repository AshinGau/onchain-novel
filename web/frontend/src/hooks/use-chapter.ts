"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchChapter,
  fetchChapterContext,
  fetchChapterChildren,
  fetchChapterBounties,
  fetchChapterTips,
} from "@/lib/api";

/** Fetch chapter detail */
export function useChapter(id: string) {
  return useQuery({
    queryKey: ["chapter", id],
    queryFn: () => fetchChapter(id),
    enabled: !!id,
  });
}

/** Fetch ancestor chain for reading */
export function useChapterContext(id: string) {
  return useQuery({
    queryKey: ["chapter-context", id],
    queryFn: async () => {
      const { ancestors } = await fetchChapterContext(id);
      return ancestors;
    },
    enabled: !!id,
  });
}

/** Fetch direct children */
export function useChapterChildren(id: string) {
  return useQuery({
    queryKey: ["chapter-children", id],
    queryFn: async () => {
      const { children } = await fetchChapterChildren(id);
      return children;
    },
    enabled: !!id,
  });
}

/** Fetch bounties for a chapter */
export function useChapterBounties(id: string) {
  return useQuery({
    queryKey: ["chapter-bounties", id],
    queryFn: async () => {
      const { bounties } = await fetchChapterBounties(id);
      return bounties;
    },
    enabled: !!id,
  });
}

/** Fetch tips for a chapter */
export function useChapterTips(id: string) {
  return useQuery({
    queryKey: ["chapter-tips", id],
    queryFn: async () => {
      const { tips } = await fetchChapterTips(id);
      return tips;
    },
    enabled: !!id,
  });
}

"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NovelCard } from "@/components/novel-card";
import type { Novel } from "@/lib/api";

const TABS = [
  { value: "hot", label: "Hot" },
  { value: "pool", label: "Highest Pool" },
  { value: "tipped", label: "Most Funded" },
  { value: "latest", label: "Latest" },
  { value: "active", label: "Active" },
] as const;

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function DiscoverTabs({ initialNovels }: { initialNovels: Novel[] }) {
  const [novels, setNovels] = useState<Novel[]>(initialNovels);
  const [loading, setLoading] = useState(false);
  const [currentTab, setCurrentTab] = useState("hot");

  async function onTabChange(value: string) {
    setCurrentTab(value);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/novels?limit=20&sort=${value}`);
      const data = await res.json();
      setNovels(data.novels || []);
    } catch {
      // keep current
    }
    setLoading(false);
  }

  return (
    <Tabs value={currentTab} onValueChange={onTabChange}>
      <TabsList className="bg-neutral-900 border border-neutral-800">
        {TABS.map(t => (
          <TabsTrigger key={t.value} value={t.value} className="text-xs data-[state=active]:bg-neutral-700">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="mt-4">
        {loading ? (
          <p className="text-neutral-500 text-sm py-8 text-center">Loading...</p>
        ) : novels.length === 0 ? (
          <p className="text-neutral-500 text-sm py-8 text-center">No novels found. Be the first to create one!</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {novels.map(n => <NovelCard key={n.id} novel={n} />)}
          </div>
        )}
      </div>
    </Tabs>
  );
}

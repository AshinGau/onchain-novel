"use client";

import { useState, useRef } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NovelCard } from "@/components/novel-card";
import { API_BASE } from "@/lib/api";
import type { Novel } from "@/lib/api";

const TABS = [
  { value: "hot", label: "Hot" },
  { value: "pool", label: "Highest Pool" },
  { value: "tipped", label: "Most Funded" },
  { value: "latest", label: "Latest" },
  { value: "active", label: "Active" },
] as const;

export function DiscoverTabs({ initialNovels }: { initialNovels: Novel[] }) {
  const [novels, setNovels] = useState<Novel[]>(initialNovels);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState("hot");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  const fetchId = useRef(0);

  async function fetchNovels(sort: string, f: string) {
    const id = ++fetchId.current;
    setLoading(true);
    setError(null);
    try {
      let url = `${API_BASE}/api/novels?limit=20&sort=${sort}`;
      if (f !== "all") url += `&filter=${f}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (id === fetchId.current) setNovels(data.novels || []);
    } catch {
      if (id === fetchId.current) setError("Failed to load novels.");
    } finally {
      if (id === fetchId.current) setLoading(false);
    }
  }

  function onTabChange(value: string) {
    setCurrentTab(value);
    fetchNovels(value, filter);
  }

  function onFilterChange(value: "all" | "active" | "completed") {
    setFilter(value);
    fetchNovels(currentTab, value);
  }

  return (
    <Tabs value={currentTab} onValueChange={onTabChange}>
      <div className="flex flex-wrap items-center gap-3">
        <TabsList className="bg-neutral-900 border border-neutral-800">
          {TABS.map(t => (
            <TabsTrigger key={t.value} value={t.value} className="text-xs data-[state=active]:bg-neutral-700">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex items-center rounded-md bg-neutral-900 border border-neutral-800 p-0.5">
          {(["all", "active", "completed"] as const).map(f => (
            <button
              key={f}
              onClick={() => onFilterChange(f)}
              className={`px-2.5 py-1 text-xs rounded-md capitalize transition-colors ${
                filter === f
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <p className="text-neutral-500 text-sm py-8 text-center">Loading...</p>
        ) : error ? (
          <p className="text-red-400 text-sm py-8 text-center">{error}</p>
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

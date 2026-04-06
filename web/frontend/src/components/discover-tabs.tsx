"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NovelCard } from "@/components/novel-card";
import { API_BASE } from "@/lib/api";
import type { Novel } from "@/lib/api";

const PAGE_SIZE = 20;

const TABS = [
  { value: "hot", label: "Hot" },
  { value: "pool", label: "Highest Pool" },
  { value: "tipped", label: "Most Funded" },
  { value: "latest", label: "Latest" },
  { value: "active", label: "Active" },
] as const;

interface Props {
  initialNovels: Novel[];
  initialTotal: number;
  initialSearch: string;
}

export function DiscoverTabs({ initialNovels, initialTotal, initialSearch }: Props) {
  const searchParams = useSearchParams();
  const search = searchParams.get("search") || "";

  const [novels, setNovels] = useState<Novel[]>(initialNovels);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState("hot");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [page, setPage] = useState(1);

  const fetchId = useRef(0);
  const prevSearch = useRef(initialSearch);

  // When search param changes from navbar, reset and fetch
  useEffect(() => {
    if (search !== prevSearch.current) {
      prevSearch.current = search;
      setPage(1);
      fetchNovels(currentTab, filter, 1, search);
    }
  }, [search]);

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  async function fetchNovels(sort: string, f: string, p: number, q?: string) {
    const id = ++fetchId.current;
    setLoading(true);
    setError(null);
    try {
      let url = `${API_BASE}/api/novels?limit=${PAGE_SIZE}&sort=${sort}&page=${p}`;
      if (f !== "all") url += `&filter=${f}`;
      const searchQuery = q ?? search;
      if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (id === fetchId.current) {
        setNovels(data.novels || []);
        setTotal(data.total ?? 0);
      }
    } catch {
      if (id === fetchId.current) setError("Failed to load novels.");
    } finally {
      if (id === fetchId.current) setLoading(false);
    }
  }

  function onTabChange(value: string) {
    setCurrentTab(value);
    setPage(1);
    fetchNovels(value, filter, 1);
  }

  function onFilterChange(value: "all" | "active" | "completed") {
    setFilter(value);
    setPage(1);
    fetchNovels(currentTab, value, 1);
  }

  function onPageChange(p: number) {
    setPage(p);
    fetchNovels(currentTab, filter, p);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        {search && (
          <span className="text-xs text-neutral-400">
            Results for &quot;{search}&quot; ({total})
          </span>
        )}
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="flex items-center gap-1 rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span className="text-xs text-neutral-500">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="flex items-center gap-1 rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}
    </Tabs>
  );
}

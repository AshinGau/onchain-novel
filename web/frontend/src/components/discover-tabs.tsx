"use client";

import { useState, useRef } from "react";
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
    setLoading(true); setError(null);
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

  return (
    <div>
      <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
        <ul className="nav nav-tabs">
          {TABS.map(t => (
            <li className="nav-item" key={t.value}>
              <button
                className={`nav-link ${currentTab === t.value ? "active" : ""}`}
                onClick={() => { setCurrentTab(t.value); fetchNovels(t.value, filter); }}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="btn-group btn-group-sm">
          {(["all", "active", "completed"] as const).map(f => (
            <button key={f} onClick={() => { setFilter(f); fetchNovels(currentTab, f); }}
              className={`btn ${filter === f ? "btn-primary" : "btn-outline-secondary"} text-capitalize`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-body-tertiary text-center py-4">Loading...</p>
      ) : error ? (
        <p className="text-danger text-center py-4">{error}</p>
      ) : novels.length === 0 ? (
        <p className="text-body-tertiary text-center py-4">No novels found. Be the first to create one!</p>
      ) : (
        <div className="row row-cols-1 row-cols-sm-2 row-cols-lg-3 g-3">
          {novels.map(n => (
            <div className="col" key={n.id}>
              <NovelCard novel={n} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

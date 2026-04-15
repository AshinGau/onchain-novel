"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SORT_OPTIONS = [
  { value: "latest", label: "Latest" },
  { value: "active", label: "Most Active" },
  { value: "pool", label: "Largest Pool" },
  { value: "hot", label: "Most Viewed" },
  { value: "tipped", label: "Most Funded" },
];

const FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

interface Props {
  currentSort: string;
  currentFilter: string;
  currentSearch: string;
  currentPage: number;
  totalPages: number;
}

export function NovelListControls({ currentSort, currentFilter, currentSearch }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState(currentSearch);

  function navigate(params: Record<string, string>) {
    const sp = new URLSearchParams();
    sp.set("sort", params.sort ?? currentSort);
    sp.set("filter", params.filter ?? currentFilter);
    if (params.search ?? search) sp.set("search", params.search ?? search);
    router.push(`/novels?${sp.toString()}`);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    navigate({ search });
  }

  const selectStyle: React.CSSProperties = {
    padding: "0.375rem 0.75rem",
    borderRadius: "0.5rem",
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-secondary)",
    color: "var(--color-text)",
    fontSize: "0.875rem",
  };

  return (
    <div className="on-row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
      <select
        value={currentSort}
        onChange={(e) => navigate({ sort: e.target.value })}
        style={selectStyle}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <select
        value={currentFilter}
        onChange={(e) => navigate({ filter: e.target.value })}
        style={selectStyle}
      >
        {FILTER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <form onSubmit={handleSearchSubmit} className="on-row" style={{ gap: "0.375rem" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, ID, or address"
          style={{
            ...selectStyle,
            width: "220px",
          }}
        />
        <button type="submit" className="on-btn on-btn-secondary">
          Search
        </button>
      </form>
    </div>
  );
}

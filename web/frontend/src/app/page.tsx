import { fetchApi, type Novel } from "@/lib/api";
import { DiscoverTabs } from "@/components/discover-tabs";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const { search } = await searchParams;
  let novels: Novel[] = [];
  let total = 0;
  try {
    let url = "/api/novels?limit=20&sort=hot";
    if (search) url += `&search=${encodeURIComponent(search)}`;
    const data = await fetchApi<{ novels: Novel[]; total: number }>(url);
    novels = data.novels;
    total = data.total;
  } catch {
    // API not available yet — show empty state
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 pb-24 md:pb-8">
      <h1 className="text-2xl font-bold mb-1">Discover Novels</h1>
      <p className="text-neutral-400 text-sm mb-6">
        Collaborative stories written by AI agents and humans, governed on-chain.
      </p>
      <DiscoverTabs initialNovels={novels} initialTotal={total} initialSearch={search || ""} />
    </div>
  );
}

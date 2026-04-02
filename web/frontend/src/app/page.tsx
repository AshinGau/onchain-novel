import { fetchApi, type Novel } from "@/lib/api";
import { NovelCard } from "@/components/novel-card";
import { DiscoverTabs } from "@/components/discover-tabs";

export default async function HomePage() {
  let novels: Novel[] = [];
  try {
    const data = await fetchApi<{ novels: Novel[] }>("/api/novels?limit=20&sort=hot");
    novels = data.novels;
  } catch {
    // API not available yet — show empty state
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 pb-24 md:pb-8">
      <h1 className="text-2xl font-bold mb-1">Discover Novels</h1>
      <p className="text-neutral-400 text-sm mb-6">
        Collaborative stories written by AI agents and humans, governed on-chain.
      </p>
      <DiscoverTabs initialNovels={novels} />
    </div>
  );
}

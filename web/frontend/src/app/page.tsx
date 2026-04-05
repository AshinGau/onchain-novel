import { fetchApi, type Novel } from "@/lib/api";
import { DiscoverTabs } from "@/components/discover-tabs";

export default async function HomePage() {
  let novels: Novel[] = [];
  try {
    const data = await fetchApi<{ novels: Novel[] }>("/api/novels?limit=20&sort=hot");
    novels = data.novels;
  } catch {}

  return (
    <div className="container-lg py-4 pb-5">
      <h2 className="fw-bold mb-1">Discover Novels</h2>
      <p className="text-body-secondary small mb-4">
        Collaborative stories written by AI agents and humans, governed on-chain.
      </p>
      <DiscoverTabs initialNovels={novels} />
    </div>
  );
}

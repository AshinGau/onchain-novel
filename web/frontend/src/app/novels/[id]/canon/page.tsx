import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchApi, type Chapter, type Novel } from "@/lib/api";
import { shortenAddress } from "@/lib/format";

export default async function CanonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let novel: Novel;
  let canonChapters: Chapter[] = [];

  try {
    novel = await fetchApi<Novel>(`/api/novels/${id}`);
  } catch {
    notFound();
  }

  try {
    const data = await fetchApi<{ chapters: Chapter[] }>(`/api/novels/${id}/canon`);
    canonChapters = data.chapters;
  } catch {}

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24 md:pb-8">
      <div className="mb-6">
        <Link href={`/novels/${id}`} className="text-sm text-neutral-400 hover:text-white">
          ← Back to Novel
        </Link>
        <h1 className="text-2xl font-bold mt-2">{novel.title || `Novel #${id}`}</h1>
        <p className="text-neutral-400 text-sm">Canon Timeline · {canonChapters.length} chapters</p>
      </div>

      {canonChapters.length === 0 ? (
        <p className="text-neutral-500">No canon chapters established yet.</p>
      ) : (
        <div className="space-y-8">
          {canonChapters.map((ch, i) => (
            <article key={ch.id} className="border-l-2 border-amber-600 pl-4">
              <div className="flex items-center gap-2 mb-2 text-sm text-neutral-400">
                <span className="font-medium text-amber-400">Chapter #{ch.chapter_index}</span>
                <span>·</span>
                <span>{shortenAddress(ch.author)}</span>
                <span>·</span>
                <Link href={`/chapters/${ch.id}`} className="hover:text-white">
                  #{ch.id}
                </Link>
              </div>
              <div className="prose prose-invert prose-neutral max-w-none leading-relaxed text-neutral-200 whitespace-pre-wrap">
                {ch.content_text || (
                  <span className="text-neutral-500 italic">Content pending...</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Reading progress */}
      <div className="mt-8 text-center text-sm text-neutral-500">
        {canonChapters.length > 0
          ? novel.active
            ? "Story continues... check back for new chapters."
            : "— The End —"
          : ""}
      </div>
    </div>
  );
}

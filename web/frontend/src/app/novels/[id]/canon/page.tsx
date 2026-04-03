import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchApi, type Chapter, type Novel } from "@/lib/api";
import { shortenAddress } from "@/lib/format";
import { ChapterNav } from "./chapter-nav";

export default async function CanonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ch?: string }>;
}) {
  const { id } = await params;
  const { ch } = await searchParams;

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

  if (canonChapters.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Link href={`/novels/${id}`} className="text-sm text-neutral-400 hover:text-white">← Back to Novel</Link>
        <h1 className="text-2xl font-bold mt-4">{novel.title || `Novel #${id}`}</h1>
        <p className="text-neutral-500 mt-4">No chapters in the main storyline yet. The story is still being written!</p>
      </div>
    );
  }

  // Determine which chapter to show
  const chapterIndex = ch ? parseInt(ch, 10) : 0;
  const currentIdx = Math.max(0, Math.min(chapterIndex, canonChapters.length - 1));
  const current = canonChapters[currentIdx];
  const prevIdx = currentIdx > 0 ? currentIdx - 1 : null;
  const nextIdx = currentIdx < canonChapters.length - 1 ? currentIdx + 1 : null;

  const tocItems = canonChapters.map((c, i) => ({
    index: i,
    label: i === 0 ? "Prologue" : `Chapter ${i}`,
    author: shortenAddress(c.author),
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="mb-8">
        <Link href={`/novels/${id}`} className="text-sm text-neutral-400 hover:text-white">← Back to Novel</Link>
        <h1 className="text-2xl font-bold mt-2">{novel.title || `Novel #${id}`}</h1>
        {novel.description && <p className="text-neutral-400 text-sm mt-1">{novel.description}</p>}
      </div>

      {/* Chapter heading */}
      <h2 className="text-lg font-semibold text-amber-400 mb-1">
        {currentIdx === 0 ? "Prologue" : `Chapter ${currentIdx}`}
      </h2>
      <p className="text-sm text-neutral-500 mb-6">{shortenAddress(current.author)}</p>

      {/* Content */}
      <article className="prose prose-invert prose-neutral max-w-none leading-relaxed text-neutral-200 mb-10">
        {current.content_text ? (
          <div className="whitespace-pre-wrap text-base leading-8">{current.content_text}</div>
        ) : (
          <p className="text-neutral-500 italic">Content not yet available.</p>
        )}
      </article>

      {/* Prev / Next */}
      <div className="flex items-center justify-between border-t border-neutral-800 pt-6">
        {prevIdx !== null ? (
          <Link href={`/novels/${id}/canon?ch=${prevIdx}`}
            className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors">
            <span>←</span>
            <span>{prevIdx === 0 ? "Prologue" : `Chapter ${prevIdx}`}</span>
          </Link>
        ) : <div />}

        <ChapterNav novelId={id} chapters={tocItems} currentIndex={currentIdx} />

        {nextIdx !== null ? (
          <Link href={`/novels/${id}/canon?ch=${nextIdx}`}
            className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors">
            <span>{`Chapter ${nextIdx}`}</span>
            <span>→</span>
          </Link>
        ) : (
          <span className="text-xs text-neutral-500">
            {novel.active ? "Awaiting next chapter..." : "— The End —"}
          </span>
        )}
      </div>
    </div>
  );
}

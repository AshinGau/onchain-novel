import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchApi, type Chapter, type Novel } from "@/lib/api";
import { shortenAddress } from "@/lib/format";
import { ChapterNav } from "./chapter-nav";

export default async function CanonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ch?: string }> }) {
  const { id } = await params;
  const { ch } = await searchParams;
  let novel: Novel; let canonChapters: Chapter[] = [];

  try { novel = await fetchApi<Novel>(`/api/novels/${id}`); } catch { notFound(); }
  try { canonChapters = (await fetchApi<{ chapters: Chapter[] }>(`/api/novels/${id}/canon`)).chapters; } catch {}

  if (canonChapters.length === 0) {
    return (
      <div className="container py-4" style={{ maxWidth: 720 }}>
        <Link href={`/novels/${id}`} className="small text-body-secondary text-decoration-none">&larr; Back to Novel</Link>
        <h2 className="fw-bold mt-3">{novel.title || `Novel #${id}`}</h2>
        <p className="text-body-tertiary mt-3">No chapters in the main storyline yet. The story is still being written!</p>
      </div>
    );
  }

  const parsed = ch ? parseInt(ch, 10) : 0;
  const chapterIndex = isNaN(parsed) ? 0 : parsed;
  const currentIdx = Math.max(0, Math.min(chapterIndex, canonChapters.length - 1));
  const current = canonChapters[currentIdx];
  const prevIdx = currentIdx > 0 ? currentIdx - 1 : null;
  const nextIdx = currentIdx < canonChapters.length - 1 ? currentIdx + 1 : null;
  const tocItems = canonChapters.map((c, i) => ({ index: i, label: i === 0 ? "Prologue" : `Chapter ${i}`, author: shortenAddress(c.author) }));

  return (
    <div className="container py-4 pb-5" style={{ maxWidth: 720 }}>
      <div className="mb-4">
        <Link href={`/novels/${id}`} className="small text-body-secondary text-decoration-none">&larr; Back to Novel</Link>
        <h2 className="fw-bold mt-2">{novel.title || `Novel #${id}`}</h2>
        {novel.description && <p className="text-body-secondary small">{novel.description}</p>}
      </div>

      <h4 className="text-warning fw-semibold mb-1">{currentIdx === 0 ? "Prologue" : `Chapter ${currentIdx}`}</h4>
      <p className="small text-body-secondary mb-4">{shortenAddress(current.author)}</p>

      <article className="chapter-prose mb-5">
        {current.content_text ? current.content_text : <p className="text-body-tertiary fst-italic">Content not yet available.</p>}
      </article>

      {/* Prev / Next */}
      <div className="d-flex justify-content-between align-items-center border-top pt-3">
        {prevIdx !== null ? (
          <Link href={`/novels/${id}/canon?ch=${prevIdx}`} className="text-decoration-none text-body-secondary small">&larr; {prevIdx === 0 ? "Prologue" : `Chapter ${prevIdx}`}</Link>
        ) : <div />}
        <ChapterNav novelId={id} chapters={tocItems} currentIndex={currentIdx} />
        {nextIdx !== null ? (
          <Link href={`/novels/${id}/canon?ch=${nextIdx}`} className="text-decoration-none text-body-secondary small">Chapter {nextIdx} &rarr;</Link>
        ) : (
          <span className="small text-body-tertiary">{novel.active ? "Awaiting next chapter..." : "— The End —"}</span>
        )}
      </div>
    </div>
  );
}

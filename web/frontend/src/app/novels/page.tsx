import { fetchNovels } from "@/lib/api";
import { NovelCard } from "@/components/novel-card";
import { NovelListControls } from "./novel-list-controls";

export default async function NovelsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const page = Number(sp.page) || 1;
  const sort = (sp.sort as string) || "latest";
  const filter = (sp.filter as string) || "";
  const search = (sp.search as string) || "";

  const data = await fetchNovels({ page, limit: 20, sort, filter, search });

  return (
    <div className="on-container on-stack">
      <h1 className="text-heading">Novels</h1>

      <NovelListControls
        currentSort={sort}
        currentFilter={filter}
        currentSearch={search}
        currentPage={page}
        totalPages={data.pagination.totalPages}
      />

      {data.novels.length === 0 ? (
        <div className="on-empty">No novels found</div>
      ) : (
        <div className="on-grid on-grid-3">
          {data.novels.map((novel) => (
            <NovelCard key={novel.id} novel={novel} />
          ))}
        </div>
      )}

      {data.pagination.totalPages > 1 && (
        <nav className="on-pagination">
          {page > 1 && (
            <a
              href={`/novels?page=${page - 1}&sort=${sort}&filter=${filter}&search=${search}`}
              className="on-btn on-btn-secondary"
            >
              Previous
            </a>
          )}
          <span className="text-caption">
            Page {page} of {data.pagination.totalPages}
          </span>
          {page < data.pagination.totalPages && (
            <a
              href={`/novels?page=${page + 1}&sort=${sort}&filter=${filter}&search=${search}`}
              className="on-btn on-btn-secondary"
            >
              Next
            </a>
          )}
        </nav>
      )}
    </div>
  );
}

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
    <div className="on-container on-stack" style={{ paddingTop: "1.5rem", paddingBottom: "2rem" }}>
      <h1 className="text-heading">Novels</h1>

      <NovelListControls
        currentSort={sort}
        currentFilter={filter}
        currentSearch={search}
        currentPage={page}
        totalPages={data.pagination.totalPages}
      />

      {data.novels.length === 0 ? (
        <div className="text-caption" style={{ textAlign: "center", padding: "3rem 0" }}>
          No novels found
        </div>
      ) : (
        <div className="on-grid" style={{ "--cols": 2 } as React.CSSProperties}>
          {data.novels.map((novel) => (
            <NovelCard key={novel.id} novel={novel} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data.pagination.totalPages > 1 && (
        <div className="on-row" style={{ justifyContent: "center", gap: "1rem", paddingTop: "1rem" }}>
          {page > 1 && (
            <a
              href={`/novels?page=${page - 1}&sort=${sort}&filter=${filter}&search=${search}`}
              className="on-btn on-btn-secondary"
              style={{ textDecoration: "none" }}
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
              style={{ textDecoration: "none" }}
            >
              Next
            </a>
          )}
        </div>
      )}
    </div>
  );
}

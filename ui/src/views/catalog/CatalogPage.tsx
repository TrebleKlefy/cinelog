import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShareIcon } from "../../components/icons/ShareIcon";
import { CatalogMovieCard } from "../../components/CatalogMovieCard";
import { ConfirmDialog, RemoveFromCatalogCopy } from "../../components/ConfirmDialog";
import { MovieDetailModal } from "../../components/MovieDetailModal";
import { InlineState } from "../../components/InlineState";
import { api } from "../../lib/api";
import type { ExternalRatingDTO } from "../../lib/movieDisplay";
import type { AuthState } from "../../types/auth";

/** Keep in sync with Discover / Search catalog preview */
const MOVIES_PAGE_SIZE = 28;

type CatalogItem = {
  id: string;
  imdbId: string | null;
  tmdbId: number | null;
  title: string;
  releaseYear: number;
  runtimeMinutes: number | null;
  posterUrl: string | null;
  externalRatings: ExternalRatingDTO[];
};

type CatalogPagedResponse = {
  items: CatalogItem[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};

type PagerProps = {
  page: number;
  pages: number;
  busy?: boolean;
  onPage: (p: number) => void;
};

function CatalogPagination({ page, pages, busy, onPage }: PagerProps) {
  if (pages <= 1) return null;

  return (
    <nav className="browse-pagination" aria-label="Catalog pagination">
      <button type="button" className="button button--sm" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="browse-pagination__meta">
        Page {page} of {pages}
      </span>
      <button type="button" className="button button--sm" disabled={busy || page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

type QuickMovieView = { kind: "catalog"; id: string };

export function CatalogPage({ auth }: { auth: AuthState }) {
  const token = auth?.token;
  const userId = auth?.user?.id;
  const [q, setQ] = useState("");
  const [cast, setCast] = useState("");
  const [director, setDirector] = useState("");
  const [genre, setGenre] = useState("");
  const [page, setPage] = useState(1);
  const [quickView, setQuickView] = useState<QuickMovieView | null>(null);
  const [catalogRemoval, setCatalogRemoval] = useState<{ id: string; title: string } | null>(null);
  const qc = useQueryClient();

  const removeFromCatalogMutation = useMutation({
    mutationFn: (movieId: string) => api<{ ok: boolean }>(`/api/me/catalog/movies/${movieId}`, { method: "DELETE" }, token),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["movies-catalog-home"] });
      await qc.invalidateQueries({ queryKey: ["movies-all"] });
      await qc.invalidateQueries({ queryKey: ["collection"] });
      await qc.invalidateQueries({ queryKey: ["search"] });
      await qc.invalidateQueries({ queryKey: ["movie"] });
      await qc.invalidateQueries({ queryKey: ["movie-detail-modal"] });
      await qc.invalidateQueries({ queryKey: ["recommendations"] });
      await qc.invalidateQueries({ queryKey: ["catalog-tmdb-ids"] });
      await qc.invalidateQueries({ queryKey: ["tmdb-browse"] });
      setCatalogRemoval(null);
    },
  });

  const titleFilter = q.trim().length > 1 ? q.trim() : "";
  const castFilter = cast.trim();
  const directorFilter = director.trim();
  const genreFilter = genre.trim();
  const typing = Boolean(titleFilter || castFilter || directorFilter || genreFilter);

  useEffect(() => {
    setPage(1);
  }, [titleFilter, castFilter, directorFilter, genreFilter]);

  const catalogBrowse = useQuery({
    queryKey: ["movies-catalog-home", userId, page],
    queryFn: () =>
      api<CatalogPagedResponse>(`/api/movies?page=${page}&pageSize=${MOVIES_PAGE_SIZE}`, undefined, token),
    enabled: !typing && Boolean(token && userId),
    staleTime: 60_000,
  });

  const catalogFilter = useQuery({
    queryKey: ["search", userId, titleFilter, castFilter, directorFilter, genreFilter, page],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(MOVIES_PAGE_SIZE),
      });
      if (titleFilter) params.set("q", titleFilter);
      if (castFilter) params.set("cast", castFilter);
      if (directorFilter) params.set("director", directorFilter);
      if (genreFilter) params.set("genre", genreFilter);
      return api<CatalogPagedResponse>(`/api/movies?${params.toString()}`, undefined, token);
    },
    enabled: typing && Boolean(token && userId),
  });

  const source = typing ? catalogFilter : catalogBrowse;
  const paged = source.data;
  const movies = paged?.items ?? [];
  const loading = source.isPending;
  const error = source.error;

  const pageCount = useMemo(
    () => paged?.pages ?? Math.max(1, Math.ceil((paged?.total ?? 0) / (paged?.pageSize ?? MOVIES_PAGE_SIZE))),
    [paged],
  );

  useEffect(() => {
    setPage((p) => (p > pageCount ? pageCount : p));
  }, [pageCount]);

  const hasRows = movies.length > 0;

  return (
    <div className="browse-page">
      <ConfirmDialog
        open={catalogRemoval !== null}
        title="Confirm removal from catalog"
        pending={removeFromCatalogMutation.isPending}
        confirmLabel="Remove from catalog"
        onCancel={() => !removeFromCatalogMutation.isPending && setCatalogRemoval(null)}
        onConfirm={() => catalogRemoval != null && removeFromCatalogMutation.mutate(catalogRemoval.id)}
      >
        {catalogRemoval ? <RemoveFromCatalogCopy movieTitle={catalogRemoval.title} /> : null}
      </ConfirmDialog>

      <MovieDetailModal
        auth={auth}
        open={quickView !== null}
        onClose={() => setQuickView(null)}
        catalogMovieId={quickView?.kind === "catalog" ? quickView.id : null}
        tmdbPreviewId={null}
      />

      <header className="browse-masthead">
        <h1 className="browse-masthead__title">Catalog</h1>
        <p className="browse-masthead__lede">
          Every title in your cineLog library, {MOVIES_PAGE_SIZE} per page. Filter by typing two or more characters in the title. Use{" "}
          <strong>Remove</strong> on a poster to drop it from your catalog (your shelf rating for that film is cleared too).{" "}
          <Link to="/search" className="browse-masthead__inline-link">
            Discover & import
          </Link>{" "}
          new movies from Search. To give friends a read-only view of picks on your shelf, open{" "}
          <Link to="/collection" className="browse-masthead__inline-link browse-masthead__share-teaser">
            <ShareIcon className="browse-masthead__share-teaser-icon" width={13} height={13} aria-hidden />
            Collection
          </Link>{" "}
          and turn on a share link from there.
        </p>
      </header>

      <section className="browse-shelf browse-shelf--standalone">
        <div className="browse-shelf__inner">
          {removeFromCatalogMutation.isError ? (
            <p className="status status--error browse-shelf__hint browse-shelf__hint--divider">
              {(removeFromCatalogMutation.error as Error).message}
            </p>
          ) : null}
          <label className="field field--on-dark">
            <span>Filter by title</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`All movies · ${MOVIES_PAGE_SIZE} per page · type 2+ characters to filter`}
            />
          </label>
          <div className="row">
            <label className="field field--on-dark">
              <span>Cast</span>
              <input value={cast} onChange={(e) => setCast(e.target.value)} placeholder="Actor name" />
            </label>
            <label className="field field--on-dark">
              <span>Director</span>
              <input value={director} onChange={(e) => setDirector(e.target.value)} placeholder="Director name" />
            </label>
            <label className="field field--on-dark">
              <span>Genre</span>
              <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Genre name" />
            </label>
          </div>
          <InlineState
            loading={loading}
            error={error ? (error as Error).message : undefined}
            hasData={hasRows}
            emptyText={typing ? "No movies matched your filter." : "Your catalog is empty — go to Search to import from TMDB."}
          />
          <div className="catalog-grid">
            {movies.map((m) => (
              <CatalogMovieCard
                key={m.id}
                detailHref={`/movies/${m.id}`}
                onPosterClick={() => setQuickView({ kind: "catalog", id: m.id })}
                title={m.title}
                posterUrl={m.posterUrl}
                runtimeMinutes={m.runtimeMinutes}
                externalRatings={m.externalRatings}
                footer={
                  <button
                    type="button"
                    className="catalog-card-remove-btn"
                    disabled={removeFromCatalogMutation.isPending}
                    title="Hide this title from your catalog and shelf"
                    onClick={() => setCatalogRemoval({ id: m.id, title: m.title })}
                  >
                    {removeFromCatalogMutation.isPending ? "Removing…" : "Remove from catalog"}
                  </button>
                }
              />
            ))}
          </div>
          <CatalogPagination page={page} pages={pageCount} busy={loading} onPage={setPage} />
        </div>
      </section>
    </div>
  );
}

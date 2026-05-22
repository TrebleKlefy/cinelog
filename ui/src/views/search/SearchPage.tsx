import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CatalogMovieCard } from "../../components/CatalogMovieCard";
import { MovieDetailModal } from "../../components/MovieDetailModal";
import { RecommendationShelf } from "../../components/RecommendationShelf";
import { InlineState } from "../../components/InlineState";
import { api } from "../../lib/api";
import type { ExternalRatingDTO } from "../../lib/movieDisplay";
import type { AuthState } from "../../types/auth";

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

type TmdbShelfResponse = {
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  items: Array<{
    tmdbId: number;
    title: string;
    releaseYear: number | null;
    posterUrl: string | null;
    voteAverage: number | null;
  }>;
};

function tmdbRatingsPreview(voteAverage: number | null): ExternalRatingDTO[] {
  if (voteAverage == null || !Number.isFinite(voteAverage)) return [];
  return [{ source: "TMDB", value: voteAverage, scale: 10, raw: null }];
}

type PagerControlledProps = {
  page: number;
  pages: number;
  busy?: boolean;
  label: string;
  onPage: (p: number) => void;
};

function BrowsePaginationControlled({ page, pages, busy, label, onPage }: PagerControlledProps) {
  if (pages <= 1) return null;

  return (
    <nav className="browse-pagination" aria-label={label}>
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

type QuickMovieView =
  | { kind: "catalog"; id: string }
  | { kind: "tmdb"; tmdbId: number };

export function SearchPage({ auth }: { auth: AuthState }) {
  const token = auth?.token;
  const userId = auth?.user?.id;
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [extQ, setExtQ] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [discoverPage, setDiscoverPage] = useState(1);
  const [quickView, setQuickView] = useState<QuickMovieView | null>(null);

  const catalogTyping = q.trim().length > 1;
  const discoverTyping = extQ.trim().length > 1;

  useEffect(() => {
    setCatalogPage(1);
  }, [q]);

  useEffect(() => {
    setDiscoverPage(1);
  }, [extQ]);

  const catalogBrowse = useQuery({
    queryKey: ["movies-catalog-home", userId, catalogPage],
    queryFn: () =>
      api<CatalogPagedResponse>(
        `/api/movies?page=${catalogPage}&pageSize=${MOVIES_PAGE_SIZE}`,
        undefined,
        token,
      ),
    enabled: !catalogTyping && Boolean(token && userId),
    staleTime: 60_000,
  });

  const catalogFilter = useQuery({
    queryKey: ["search", userId, q, catalogPage],
    queryFn: () =>
      api<CatalogPagedResponse>(
        `/api/movies?q=${encodeURIComponent(q)}&page=${catalogPage}&pageSize=${MOVIES_PAGE_SIZE}`,
        undefined,
        token,
      ),
    enabled: catalogTyping && Boolean(token && userId),
  });

  const extTrending = useQuery({
    queryKey: ["tmdb-trending", discoverPage],
    queryFn: () =>
      api<TmdbShelfResponse>(`/api/movies/external/tmdb/trending?window=week&page=${discoverPage}&pageSize=${MOVIES_PAGE_SIZE}`),
    enabled: !discoverTyping,
    staleTime: 5 * 60_000,
  });

  const extSearch = useQuery({
    queryKey: ["tmdb-search", extQ, discoverPage],
    queryFn: () =>
      api<TmdbShelfResponse>(
        `/api/movies/external/tmdb/search?q=${encodeURIComponent(extQ)}&page=${discoverPage}&pageSize=${MOVIES_PAGE_SIZE}`,
      ),
    enabled: discoverTyping,
  });

  const importMut = useMutation({
    mutationFn: (tmdbId: number) =>
      api<{ created: boolean; movie: { id: string; title: string } }>(
        "/api/movies/import/tmdb",
        { method: "POST", body: JSON.stringify({ tmdbId }) },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["movies-all"] });
      qc.invalidateQueries({ queryKey: ["movies-catalog-home"] });
    },
  });

  const catalogSource = catalogTyping ? catalogFilter : catalogBrowse;
  const catalogPaged = catalogSource.data;
  const catalogMovies = catalogPaged?.items ?? [];
  const catalogLoading = catalogSource.isPending;
  const catalogError = catalogSource.error;

  const discoverSource = discoverTyping ? extSearch : extTrending;
  const discoverPaged = discoverSource.data;
  const discoverItems = discoverPaged?.items ?? [];
  const discoverLoading = discoverSource.isPending;
  const discoverError = discoverSource.error;

  const catalogPageCount = useMemo(
    () => catalogPaged?.pages ?? Math.max(1, Math.ceil((catalogPaged?.total ?? 0) / (catalogPaged?.pageSize ?? MOVIES_PAGE_SIZE))),
    [catalogPaged],
  );
  const discoverPageCount = useMemo(() => discoverPaged?.pages ?? 1, [discoverPaged?.pages]);

  useEffect(() => {
    setCatalogPage((p) => (p > catalogPageCount ? catalogPageCount : p));
  }, [catalogPageCount]);

  useEffect(() => {
    setDiscoverPage((p) => (p > discoverPageCount ? discoverPageCount : p));
  }, [discoverPageCount]);

  const catalogHasRows = useMemo(() => catalogMovies.length > 0, [catalogMovies.length]);
  const discoverHasRows = useMemo(() => discoverItems.length > 0, [discoverItems.length]);

  const discoverSubtitle = discoverTyping ? "TMDB search" : "Trending this week";

  const discoverCards = useMemo(() => {
    return discoverItems.map((item) => {
      const subtitleYear = item.releaseYear != null ? ` (${item.releaseYear})` : "";
      return (
        <CatalogMovieCard
          key={`${discoverTyping ? "s" : "t"}-${item.tmdbId}`}
          title={`${item.title}${subtitleYear}`}
          posterUrl={item.posterUrl}
          runtimeMinutes={null}
          onPosterClick={() => setQuickView({ kind: "tmdb", tmdbId: item.tmdbId })}
          externalRatings={tmdbRatingsPreview(item.voteAverage)}
          footer={
            <button
              type="button"
              className="button button--gold button--sm catalog-card__footer-anchor"
              disabled={importMut.isPending || !token}
              onClick={() => importMut.mutate(item.tmdbId)}
            >
              {!token ? "Sign in to import" : importMut.isPending ? "…" : "Add to catalog"}
            </button>
          }
        />
      );
    });
  }, [discoverItems, discoverTyping, importMut.isPending, token]);

  return (
    <div className="browse-page">
      <MovieDetailModal
        auth={auth}
        open={quickView !== null}
        onClose={() => setQuickView(null)}
        catalogMovieId={quickView?.kind === "catalog" ? quickView.id : null}
        tmdbPreviewId={quickView?.kind === "tmdb" ? quickView.tmdbId : null}
      />
      <header className="browse-masthead">
        <h1 className="browse-masthead__title">Movies</h1>
        <p className="browse-masthead__lede">
          Browse titles in your catalog or explore{" "}
          <a href="https://developer.themoviedb.org/docs/getting-started">The Movie Database</a>: trending fills the shelf by default; type two or more
          characters to search TMDB and your library. Each grid shows up to {MOVIES_PAGE_SIZE} titles per page.
        </p>
      </header>

      <section className="browse-shelf browse-shelf--connect">
        <div className="browse-shelf__inner">
          <h2 className="shelf-heading">Your catalog</h2>
          <label className="field field--on-dark">
            <span>Filter by title</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Shows ${MOVIES_PAGE_SIZE} movies per page · type to filter (2+ characters)`}
            />
          </label>
          <InlineState
            loading={catalogLoading}
            error={catalogError ? (catalogError as Error).message : undefined}
            hasData={catalogHasRows}
            emptyText={catalogTyping ? "No movies matched your filter." : "Your catalog is empty — browse Discover below and import a title."}
          />
          <div className="catalog-grid">
            {catalogMovies.map((m) => (
              <CatalogMovieCard
                key={m.id}
                detailHref={`/movies/${m.id}`}
                onPosterClick={() => setQuickView({ kind: "catalog", id: m.id })}
                title={m.title}
                posterUrl={m.posterUrl}
                runtimeMinutes={m.runtimeMinutes}
                externalRatings={m.externalRatings}
              />
            ))}
          </div>
          <BrowsePaginationControlled
            page={catalogPage}
            pages={catalogPageCount}
            busy={catalogLoading}
            label="Catalog pagination"
            onPage={setCatalogPage}
          />
          <div className="browse-catalog-see-all">
            <Link to="/catalog" className="button button--secondary button--sm">
              See all catalog
            </Link>
          </div>
        </div>
      </section>

      <section className="browse-shelf browse-shelf--standalone">
        <div className="browse-shelf__inner">
          <h2 className="shelf-heading">Discover & import</h2>
          <p className="browse-shelf__hint">
            <strong>{discoverSubtitle}.</strong> Set <code>TMDB_READ_ACCESS_TOKEN</code> (recommended) or <code>TMDB_API_KEY</code> on the API server.
            Sign in to import.
          </p>
          <label className="field field--on-dark">
            <span>Search TMDB</span>
            <input
              value={extQ}
              onChange={(e) => setExtQ(e.target.value)}
              placeholder={`Trending loads ${MOVIES_PAGE_SIZE} titles per page · search with 2+ characters`}
            />
          </label>
          <InlineState
            loading={discoverLoading}
            error={discoverError ? (discoverError as Error).message : undefined}
            hasData={discoverHasRows}
            emptyText={discoverTyping ? "No TMDB matches for that search." : "Could not load trending titles."}
          />
          {importMut.error && <p className="status status--error">{(importMut.error as Error).message}</p>}
          {importMut.isSuccess && (
            <p className="status status--info">
              {importMut.data.created ? "Imported" : "Updated"}: {importMut.data.movie.title}
            </p>
          )}
          <div className="catalog-grid">{discoverCards}</div>
          <BrowsePaginationControlled
            page={discoverPage}
            pages={discoverPageCount}
            busy={discoverLoading}
            label="Discover pagination"
            onPage={setDiscoverPage}
          />

          <div className="browse-discover-after">
            <p className="browse-shelf__hint browse-shelf__hint--divider">
              <strong>For you.</strong> Personalized picks based on your history and catalog — import any TMDB-backed card with one tap.
            </p>
            <RecommendationShelf auth={auth} headingClassName="shelf-heading" heading="Recommendations" />
          </div>
        </div>
      </section>
    </div>
  );
}

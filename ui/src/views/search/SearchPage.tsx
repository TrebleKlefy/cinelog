import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CatalogMovieCard } from "../../components/CatalogMovieCard";
import { MovieDetailModal } from "../../components/MovieDetailModal";
import { RecommendationShelf } from "../../components/RecommendationShelf";
import { InlineState } from "../../components/InlineState";
import { useTmdbCatalogImport } from "../../hooks/useTmdbCatalogImport";
import { api } from "../../lib/api";
import type { ExternalRatingDTO } from "../../lib/movieDisplay";
import type { AuthState } from "../../types/auth";

const MOVIES_PAGE_SIZE = 28;

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
    inCatalog?: boolean;
  }>;
};

type NlSearchMatch = {
  title: string;
  year?: number;
  reason: string;
  tmdbId?: number | null;
  posterUrl?: string | null;
  voteAverage?: number | null;
};

type NlSearchResponse = {
  matches: NlSearchMatch[];
  notes?: string;
};

type GenreListResponse = {
  items: string[];
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

type QuickMovieView = { tmdbId: number };

export function SearchPage({ auth }: { auth: AuthState }) {
  const token = auth?.token;
  const userId = auth?.user?.id;
  const [cast, setCast] = useState("");
  const [director, setDirector] = useState("");
  const [genre, setGenre] = useState("");
  const [nlQuery, setNlQuery] = useState("");
  const [extQ, setExtQ] = useState("");
  const [discoverPage, setDiscoverPage] = useState(1);
  const [quickView, setQuickView] = useState<QuickMovieView | null>(null);

  const castFilter = cast.trim();
  const directorFilter = director.trim();
  const genreFilter = genre.trim();
  const titleQuery = extQ.trim();

  const resetDiscoverPage = () => setDiscoverPage(1);

  const onDiscoverChange = (value: string) => {
    setExtQ(value);
    resetDiscoverPage();
  };
  const onCastChange = (value: string) => {
    setCast(value);
    resetDiscoverPage();
  };
  const onDirectorChange = (value: string) => {
    setDirector(value);
    resetDiscoverPage();
  };
  const onGenreChange = (value: string) => {
    setGenre(value);
    resetDiscoverPage();
  };

  const discoverBrowse = useQuery({
    queryKey: ["tmdb-browse", titleQuery, castFilter, directorFilter, genreFilter, discoverPage],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(discoverPage),
        pageSize: String(MOVIES_PAGE_SIZE),
      });
      if (titleQuery.length >= 2) params.set("q", titleQuery);
      if (castFilter) params.set("cast", castFilter);
      if (directorFilter) params.set("director", directorFilter);
      if (genreFilter) params.set("genre", genreFilter);
      return api<TmdbShelfResponse>(`/api/movies/external/tmdb/browse?${params.toString()}`, undefined, token);
    },
    staleTime: titleQuery || castFilter || directorFilter || genreFilter ? 0 : 5 * 60_000,
  });

  const genreOptions = useQuery({
    queryKey: ["tmdb-genres"],
    queryFn: () => api<GenreListResponse>("/api/movies/external/tmdb/genres"),
    staleTime: 24 * 60 * 60_000,
  });

  const { importTmdb, importLabel, isImportDisabled, importError } = useTmdbCatalogImport(token, userId);

  const nlSearchMut = useMutation({
    mutationFn: (query: string) =>
      api<NlSearchResponse>(
        "/api/ai/nl-search",
        {
          method: "POST",
          body: JSON.stringify({ query }),
        },
        token,
      ),
  });

  const discoverPaged = discoverBrowse.data;
  const discoverItems = discoverPaged?.items ?? [];
  const discoverLoading = discoverBrowse.isPending;
  const discoverError = discoverBrowse.error;

  const discoverPageCount = useMemo(() => discoverPaged?.pages ?? 1, [discoverPaged?.pages]);

  const discoverHasRows = useMemo(() => discoverItems.length > 0, [discoverItems.length]);

  const discoverHasFilters = Boolean(titleQuery.length >= 2 || castFilter || directorFilter || genreFilter);

  const discoverSubtitle = useMemo(() => {
    if (castFilter || directorFilter || genreFilter) {
      if (titleQuery.length >= 2) return "TMDB discover (filtered + title)";
      return "TMDB discover";
    }
    if (titleQuery.length >= 2) return "TMDB search";
    return "Trending this week";
  }, [castFilter, directorFilter, genreFilter, titleQuery]);

  const discoverCards = discoverItems.map((item) => {
    const subtitleYear = item.releaseYear != null ? ` (${item.releaseYear})` : "";
    return (
      <CatalogMovieCard
        key={`discover-${item.tmdbId}`}
        title={`${item.title}${subtitleYear}`}
        posterUrl={item.posterUrl}
        runtimeMinutes={null}
        onPosterClick={() => setQuickView({ tmdbId: item.tmdbId })}
        externalRatings={tmdbRatingsPreview(item.voteAverage)}
        footer={
          <button
            type="button"
            className="button button--gold button--sm catalog-card__footer-anchor"
            disabled={isImportDisabled(item.tmdbId)}
            onClick={() => importTmdb(item.tmdbId)}
          >
            {importLabel(item.tmdbId)}
          </button>
        }
      />
    );
  });

  return (
    <div className="browse-page">
      <MovieDetailModal
        auth={auth}
        open={quickView !== null}
        onClose={() => setQuickView(null)}
        catalogMovieId={null}
        tmdbPreviewId={quickView?.tmdbId ?? null}
      />
      <header className="browse-masthead">
        <h1 className="browse-masthead__title">Movies</h1>
        <p className="browse-masthead__lede">
          Explore{" "}
          <a href="https://developer.themoviedb.org/docs/getting-started">The Movie Database</a>: trending fills the shelf by default; type two or more
          characters to search TMDB. Each grid shows up to {MOVIES_PAGE_SIZE} titles per page.
        </p>
      </header>

      <section className="browse-shelf browse-shelf--connect">
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
              onChange={(e) => onDiscoverChange(e.target.value)}
              placeholder={`Trending loads ${MOVIES_PAGE_SIZE} titles per page · search with 2+ characters`}
            />
          </label>
          <div className="row">
            <label className="field field--on-dark">
              <span>Cast</span>
              <input value={cast} onChange={(e) => onCastChange(e.target.value)} placeholder="Actor name" />
            </label>
            <label className="field field--on-dark">
              <span>Director</span>
              <input value={director} onChange={(e) => onDirectorChange(e.target.value)} placeholder="Director name" />
            </label>
          </div>
          <label className="field field--on-dark">
            <span>Genre</span>
            <select value={genre} onChange={(e) => onGenreChange(e.target.value)}>
              <option value="">All genres</option>
              {(genreOptions.data?.items ?? []).map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--on-dark">
            <span>Natural language search</span>
            <div className="row row--shelf">
              <input
                value={nlQuery}
                onChange={(e) => setNlQuery(e.target.value)}
                placeholder="Example: a 90s sci-fi with time travel"
              />
              <button
                type="button"
                className="button button--secondary button--sm"
                disabled={!token || nlSearchMut.isPending || nlQuery.trim().length < 2}
                onClick={() => nlSearchMut.mutate(nlQuery.trim())}
              >
                {nlSearchMut.isPending ? "Searching…" : "Run AI search"}
              </button>
            </div>
          </label>
          {nlSearchMut.isError ? <p className="status status--error">{(nlSearchMut.error as Error).message}</p> : null}
          {nlSearchMut.data ? (
            <div className="search-panel">
              <p className="browse-shelf__hint">
                <strong>AI matches.</strong> {nlSearchMut.data.notes ?? "Results ranked by semantic fit."}
              </p>
              {nlSearchMut.data.matches.length === 0 ? (
                <p className="browse-shelf__hint">No natural-language matches for that query.</p>
              ) : (
                <div className="catalog-grid dashboard-rec-grid">
                  {nlSearchMut.data.matches.map((m, i) => {
                    if (m.tmdbId == null) return null;
                    const cardTitle = m.year != null ? `${m.title} (${m.year})` : m.title;

                    return (
                      <CatalogMovieCard
                        key={`nl-tmdb:${m.tmdbId}-${i}`}
                        title={cardTitle}
                        posterUrl={m.posterUrl ?? null}
                        onPosterClick={() => setQuickView({ tmdbId: m.tmdbId! })}
                        externalRatings={tmdbRatingsPreview(m.voteAverage ?? null)}
                        footer={
                          <div className="dashboard-rec-card-footer">
                            <p className="dashboard-rec-footer__why">{m.reason}</p>
                            <div className="dashboard-rec-footer-slot p-2">
                              <button
                                type="button"
                                className="button button--gold button--sm dashboard-rec-import-btn pt-2"
                                disabled={isImportDisabled(m.tmdbId!)}
                                onClick={() => importTmdb(m.tmdbId!)}
                              >
                                {importLabel(m.tmdbId!)}
                              </button>
                              {importError(m.tmdbId!) ? (
                                <p className="status status--error dashboard-rec-import-status">{importError(m.tmdbId!)}</p>
                              ) : null}
                            </div>
                          </div>
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          <InlineState
            loading={discoverLoading}
            error={discoverError ? (discoverError as Error).message : undefined}
            hasData={discoverHasRows}
            emptyText={
              discoverHasFilters ? "No TMDB matches for those filters." : "Could not load trending titles."
            }
          />

          <div className="catalog-grid">{discoverCards}</div>
          <BrowsePaginationControlled
            page={discoverPage}
            pages={discoverPageCount}
            busy={discoverLoading}
            label="Discover pagination"
            onPage={(next) => setDiscoverPage(Math.max(1, Math.min(discoverPageCount, next)))}
          />

          <div className="browse-discover-after">
            <p className="browse-shelf__hint browse-shelf__hint--divider">
              <strong>For you.</strong> Personalized picks based on your history — import any TMDB-backed card with one tap.
            </p>
            <RecommendationShelf auth={auth} headingClassName="shelf-heading" heading="Recommendations" />
          </div>
        </div>
      </section>
    </div>
  );
}

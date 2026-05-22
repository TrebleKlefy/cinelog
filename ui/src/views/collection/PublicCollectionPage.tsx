import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CatalogMovieCard } from "../../components/CatalogMovieCard";
import { MovieDetailModal } from "../../components/MovieDetailModal";
import { InlineState } from "../../components/InlineState";
import { api } from "../../lib/api";
import type { ExternalRatingDTO } from "../../lib/movieDisplay";
import type { AuthState } from "../../types/auth";

type PublicCollectionApi = {
  slug: string;
  title: string;
  ownerDisplayName: string;
  movies: Array<{
    addedAt: string;
    notes: string | null;
    movie: {
      id: string;
      imdbId: string | null;
      tmdbId: number | null;
      title: string;
      releaseYear: number;
      runtimeMinutes: number | null;
      posterUrl: string | null;
      genres: string[];
      externalRatings: ExternalRatingDTO[];
    };
  }>;
};

export function PublicCollectionPage({ auth }: { auth: AuthState | null }) {
  const { slug } = useParams<{ slug: string }>();
  const [tmdbPreviewId, setTmdbPreviewId] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ["public-collection", slug],
    queryFn: () => api<PublicCollectionApi>(`/api/collections/${encodeURIComponent(slug!)}`),
    enabled: typeof slug === "string" && slug.length > 0,
  });

  const items = q.data?.movies ?? [];

  const title = useMemo(() => {
    if (!q.data) return "Shared collection";
    return `${q.data.title} · ${q.data.ownerDisplayName}`;
  }, [q.data]);

  return (
    <div className="public-collection-page">
      <header className="public-collection-bar">
        <Link to="/" className="public-collection-bar__brand">
          <img src="/cinelog-logo.png" alt="" width={36} height={36} decoding="async" className="public-collection-bar__logo" aria-hidden />
          <span className="public-collection-bar__wordmark">cineLog</span>
        </Link>
        <nav className="public-collection-bar__actions" aria-label="Account">
          {auth ? (
            <Link to="/search" className="button button--secondary button--sm">
              Back to app
            </Link>
          ) : (
            <Link to="/" className="button button--gold button--sm">
              Sign in
            </Link>
          )}
        </nav>
      </header>

      <main className="public-collection-main container">
        <header className="browse-masthead browse-masthead--public-collection">
          <p className="browse-masthead__eyebrow">Shared shelf</p>
          <h1 className="browse-masthead__title">{title}</h1>
          <p className="browse-masthead__lede">
            Read-only view of a member&apos;s watch list on cineLog. Poster tap opens TMDB synopsis when available.
          </p>
        </header>

        <MovieDetailModal
          auth={auth}
          open={tmdbPreviewId != null}
          onClose={() => setTmdbPreviewId(null)}
          catalogMovieId={null}
          tmdbPreviewId={tmdbPreviewId}
        />

        <section className="browse-shelf browse-shelf--standalone">
          <div className="browse-shelf__inner">
            <InlineState
              loading={q.isPending}
              error={q.error ? (q.error as Error).message : undefined}
              hasData={items.length > 0}
              emptyText="This shelf is unavailable or marked private."
            />
            <div className="catalog-grid">
              {items.map((m) => {
                const tid = m.movie.tmdbId;
                return (
                  <CatalogMovieCard
                    key={m.movie.id}
                    title={m.movie.title}
                    posterUrl={m.movie.posterUrl}
                    runtimeMinutes={m.movie.runtimeMinutes}
                    externalRatings={m.movie.externalRatings}
                    onPosterClick={tid != null ? () => setTmdbPreviewId(tid) : undefined}
                  />
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

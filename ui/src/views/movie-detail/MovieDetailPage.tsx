import type { CSSProperties } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog, RemoveFromCatalogCopy } from "../../components/ConfirmDialog";
import { MoviePoster } from "../../components/MoviePoster";
import { InlineState } from "../../components/InlineState";
import { api } from "../../lib/api";
import type { AuthState } from "../../types/auth";

type MovieDetail = {
  id: string;
  imdbId: string | null;
  tmdbId: number | null;
  title: string;
  releaseYear: number;
  runtimeMinutes: number | null;
  synopsis: string | null;
  posterUrl: string | null;
  genres: string[];
  cast: Array<{ name: string; character: string | null }>;
  directors: string[];
  externalRatings: Array<{ source: string; value: number; scale: number; raw: string | null }>;
  userRating: number | null;
};

function ratingLabel(source: string): string {
  if (source === "IMDB") return "IMDb";
  if (source === "ROTTEN_TOMATOES") return "Rotten Tomatoes";
  if (source === "TMDB") return "TMDB";
  return source;
}

export function MovieDetailPage({ auth }: { auth: AuthState }) {
  const { movieId } = useParams<{ movieId: string }>();
  const navigate = useNavigate();
  const token = auth?.token;
  const userId = auth?.user?.id;
  const qc = useQueryClient();
  const [catalogRemovalOpen, setCatalogRemovalOpen] = useState(false);

  const removeFromCatalogMutation = useMutation({
    mutationFn: (mid: string) => api<{ ok: boolean }>(`/api/me/catalog/movies/${mid}`, { method: "DELETE" }, token),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["movies-catalog-home"] });
      await qc.invalidateQueries({ queryKey: ["movies-all"] });
      await qc.invalidateQueries({ queryKey: ["collection"] });
      await qc.invalidateQueries({ queryKey: ["search"] });
      await qc.invalidateQueries({ queryKey: ["movie"] });
      await qc.invalidateQueries({ queryKey: ["movie-detail-modal"] });
      await qc.invalidateQueries({ queryKey: ["recommendations"] });
      setCatalogRemovalOpen(false);
      navigate("/catalog");
    },
  });

  const movie = useQuery({
    queryKey: ["movie", userId, movieId],
    queryFn: () => api<MovieDetail>(`/api/movies/${movieId}`, undefined, token),
    enabled: Boolean(movieId && userId && token),
  });

  const heroStyle: CSSProperties | undefined =
    movie.data?.posterUrl != null
      ? ({
          "--movie-hero-image": `url(${movie.data.posterUrl})`,
        } as CSSProperties)
      : undefined;

  return (
    <div className="movie-detail">
      <ConfirmDialog
        open={catalogRemovalOpen && Boolean(movie.data?.title)}
        title="Confirm removal from catalog"
        pending={removeFromCatalogMutation.isPending}
        confirmLabel="Remove from catalog"
        onCancel={() => !removeFromCatalogMutation.isPending && setCatalogRemovalOpen(false)}
        onConfirm={() => movie.data != null && removeFromCatalogMutation.mutate(movie.data.id)}
      >
        {movie.data?.title ? <RemoveFromCatalogCopy movieTitle={movie.data.title} /> : null}
      </ConfirmDialog>

      <div className="movie-detail__toolbar">
        <Link to="/search" className="movie-detail__back">
          ← Back to search
        </Link>
      </div>

      <InlineState
        loading={movie.isLoading}
        error={movie.error ? (movie.error as Error).message : undefined}
        hasData={Boolean(movie.data)}
        emptyText="Movie not found."
      />

      {movie.data && (
        <>
          <header className="movie-hero" style={heroStyle}>
            <div className="movie-hero__backdrop" aria-hidden />
            <div className="movie-hero__vignette" aria-hidden />
            <div className="movie-hero__grid">
              <div className="movie-hero__poster-wrap">
                <MoviePoster src={movie.data.posterUrl} alt={movie.data.title} className="movie-hero__poster-img" />
              </div>
              <div className="movie-hero__copy">
                <p className="movie-hero__eyebrow">
                  {movie.data.releaseYear}
                  {movie.data.runtimeMinutes != null ? ` · ${movie.data.runtimeMinutes} min` : ""}
                  {movie.data.imdbId ? ` · ${movie.data.imdbId}` : ""}
                  {movie.data.tmdbId != null ? ` · TMDB ${movie.data.tmdbId}` : ""}
                </p>
                <h1 className="movie-hero__title">{movie.data.title}</h1>
                {movie.data.genres.length > 0 && (
                  <ul className="movie-hero__genres">
                    {movie.data.genres.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                )}
                {movie.data.directors.length > 0 && (
                  <p className="movie-hero__directors">
                    <span className="movie-hero__label">Directed by</span> {movie.data.directors.join(", ")}
                  </p>
                )}
                <div className="movie-hero__ratings">
                  {movie.data.externalRatings.map((er) => (
                    <div key={er.source} className="rating-pill">
                      <span className="rating-pill__source">{ratingLabel(er.source)}</span>
                      <span className="rating-pill__value">
                        {er.raw ??
                          (er.scale === 100 ? `${Math.round(er.value)}%` : `${er.value}/${er.scale}`)}
                      </span>
                    </div>
                  ))}
                  {movie.data.userRating != null && (
                    <div className="rating-pill rating-pill--you">
                      <span className="rating-pill__source">Your score</span>
                      <span className="rating-pill__value">{movie.data.userRating}/10</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>

          <section className="movie-detail__panel page-card">
            <div className="page-card__content movie-detail__panel-inner">
              {movie.data.synopsis && (
                <div className="movie-synopsis">
                  <h2 className="section-title">Synopsis</h2>
                  <p>{movie.data.synopsis}</p>
                </div>
              )}

              {movie.data.cast.length > 0 && (
                <div className="movie-cast">
                  <h2 className="section-title">Cast</h2>
                  <ul className="cast-grid">
                    {movie.data.cast.map((c, i) => (
                      <li key={`${c.name}-${i}`} className="cast-chip">
                        <strong>{c.name}</strong>
                        {c.character ? <span>{c.character}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="movie-detail-catalog-actions">
                <p>Done with this title? Remove it from your catalog — it clears your shelf link and rating. Import again anytime from Search.</p>
                <button
                  type="button"
                  className="movie-detail-remove-catalog"
                  disabled={removeFromCatalogMutation.isPending}
                  onClick={() => setCatalogRemovalOpen(true)}
                >
                  {removeFromCatalogMutation.isPending ? "Removing…" : "Remove from catalog"}
                </button>
                {removeFromCatalogMutation.isError ? (
                  <p className="status status--error movie-detail-remove-catalog-status">{(removeFromCatalogMutation.error as Error).message}</p>
                ) : null}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

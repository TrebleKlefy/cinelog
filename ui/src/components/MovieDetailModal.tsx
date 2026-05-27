import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ConfirmDialog, RemoveFromCatalogCopy } from "./ConfirmDialog";
import { MoviePoster } from "./MoviePoster";
import { useTmdbCatalogImport } from "../hooks/useTmdbCatalogImport";
import { api } from "../lib/api";
import type { AuthState } from "../types/auth";

type CatalogMovieApi = {
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

type TmdbPreviewApi = {
  tmdbId: number;
  imdbId: string | null;
  title: string;
  releaseYear: number;
  runtimeMinutes: number | null;
  synopsis: string | null;
  posterUrl: string | null;
  genres: string[];
  directors: string[];
  cast: Array<{ name: string; character: string | null }>;
  voteAverage: number | null;
};

function ratingLabel(source: string): string {
  if (source === "IMDB") return "IMDb";
  if (source === "ROTTEN_TOMATOES") return "Rotten Tomatoes";
  if (source === "TMDB") return "TMDB";
  return source;
}

export function MovieDetailModal({
  auth,
  open,
  onClose,
  catalogMovieId,
  tmdbPreviewId,
}: {
  auth: AuthState | null;
  open: boolean;
  onClose: () => void;
  catalogMovieId: string | null;
  tmdbPreviewId: number | null;
}) {
  const token = auth?.token;
  const userId = auth?.user?.id;
  const qc = useQueryClient();
  const isCatalog = Boolean(catalogMovieId);
  const isTmdbPreview = Boolean(tmdbPreviewId) && !catalogMovieId;

  const catalogQ = useQuery({
    queryKey: ["movie-detail-modal", userId, catalogMovieId],
    queryFn: () => api<CatalogMovieApi>(`/api/movies/${catalogMovieId}`, undefined, token),
    enabled: open && isCatalog && Boolean(userId),
  });

  const tmdbQ = useQuery({
    queryKey: ["movie-detail-modal-tmdb", tmdbPreviewId],
    queryFn: () => api<TmdbPreviewApi>(`/api/movies/external/tmdb/movie/${tmdbPreviewId}`, undefined),
    enabled: open && isTmdbPreview,
  });

  const [ratingDraft, setRatingDraft] = useState(7);
  const [castExpanded, setCastExpanded] = useState(false);
  const [catalogRemoveOpen, setCatalogRemoveOpen] = useState(false);
  useEffect(() => {
    if (open && catalogMovieId) setRatingDraft(7);
  }, [open, catalogMovieId]);

  useEffect(() => {
    if (open) setCastExpanded(false);
  }, [open, catalogMovieId, tmdbPreviewId]);

  const { importTmdb, importLabel, isImportDisabled, importError, addedMovie, getStatus } = useTmdbCatalogImport(token, userId);

  const ratingMutation = useMutation({
    mutationFn: (rating: number) =>
      api<{ ok: boolean }>(
        "/api/me/ratings",
        { method: "POST", body: JSON.stringify({ movieId: catalogMovieId as string, rating }) },
        token,
      ),
    onSuccess: async () => {
      if (!catalogMovieId || !userId) return;
      await qc.invalidateQueries({ queryKey: ["movie-detail-modal", userId, catalogMovieId] });
      await qc.invalidateQueries({ queryKey: ["movie", userId, catalogMovieId] });
      await qc.invalidateQueries({ queryKey: ["movies-catalog-home"] });
      await qc.invalidateQueries({ queryKey: ["search"] });
      await qc.invalidateQueries({ queryKey: ["collection"] });
    },
  });

  const removeFromCatalogMutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean }>(`/api/me/catalog/movies/${catalogMovieId as string}`, { method: "DELETE" }, token),
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
      onClose();
    },
  });

  useEffect(() => {
    if (!open) removeFromCatalogMutation.reset();
  }, [open, catalogMovieId]);

  useEffect(() => {
    if (!open) setCatalogRemoveOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const loading = isCatalog ? catalogQ.isFetching : tmdbQ.isFetching;
  const errMsg = ((isCatalog ? catalogQ.error : tmdbQ.error) as Error | null)?.message;
  const d = catalogQ.data as CatalogMovieApi | undefined;
  const tp = tmdbQ.data;

  let title = "";
  let releaseYear = 0;
  let runtimeMinutes: number | null = null;
  let synopsis: string | null = null;
  let posterUrl: string | null = null;
  let genres: string[] = [];
  let directors: string[] = [];
  let cast: Array<{ name: string; character: string | null }> = [];
  let externalRatings: Array<{ source: string; value: number; scale: number; raw: string | null }> = [];
  let userRating: number | null = null;

  if (isCatalog && d) {
    title = d.title;
    releaseYear = d.releaseYear;
    runtimeMinutes = d.runtimeMinutes;
    synopsis = d.synopsis;
    posterUrl = d.posterUrl;
    genres = d.genres;
    directors = d.directors;
    cast = d.cast;
    externalRatings = d.externalRatings;
    userRating = d.userRating;
  } else if (isTmdbPreview && tp) {
    title = tp.title;
    releaseYear = tp.releaseYear;
    runtimeMinutes = tp.runtimeMinutes;
    synopsis = tp.synopsis;
    posterUrl = tp.posterUrl;
    genres = tp.genres;
    directors = tp.directors;
    cast = tp.cast;
    if (tp.voteAverage != null) {
      const v = Number(tp.voteAverage.toFixed(1));
      externalRatings = [{ source: "TMDB", value: v, scale: 10, raw: `${v}/10` }];
    }
    userRating = null;
  }

  const fullPageHref = catalogMovieId ? `/movies/${catalogMovieId}` : undefined;
  const hasBody = Boolean(d || tp);

  const ui = (
    <div className="movie-modal-root" role="presentation">
      <ConfirmDialog
        open={catalogRemoveOpen && Boolean(d?.title)}
        title="Confirm removal from catalog"
        pending={removeFromCatalogMutation.isPending}
        confirmLabel="Remove from catalog"
        onCancel={() => !removeFromCatalogMutation.isPending && setCatalogRemoveOpen(false)}
        onConfirm={() => {
          removeFromCatalogMutation.mutate();
        }}
      >
        {d?.title ? <RemoveFromCatalogCopy movieTitle={d.title} /> : null}
      </ConfirmDialog>

      <button
        type="button"
        className="movie-modal-overlay"
        aria-label="Close details"
        onClick={() => {
          if (catalogRemoveOpen) {
            if (!removeFromCatalogMutation.isPending) setCatalogRemoveOpen(false);
            return;
          }
          onClose();
        }}
      />
      <div
        className="movie-modal-dialog"
        role="dialog"
        aria-modal
        aria-labelledby="movie-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="movie-modal-toolbar">
          <div className="movie-modal-toolbar__start">
            {fullPageHref ? (
              <Link to={fullPageHref} className="movie-modal-toolbar-link" onClick={onClose}>
                Open full page
              </Link>
            ) : (
              <span className="movie-modal-toolbar-muted">TMDB preview</span>
            )}
            {isCatalog && token && catalogMovieId && d ? (
              <button
                type="button"
                className="movie-modal-remove-catalog"
                disabled={removeFromCatalogMutation.isPending}
                onClick={() => setCatalogRemoveOpen(true)}
              >
                Remove from catalog
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="movie-modal-close"
            onClick={() => {
              if (catalogRemoveOpen) {
                if (!removeFromCatalogMutation.isPending) setCatalogRemoveOpen(false);
                return;
              }
              onClose();
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {removeFromCatalogMutation.isError ? (
          <p className="status status--error movie-modal-inline-error">
            {(removeFromCatalogMutation.error as Error).message}
          </p>
        ) : null}

        {loading ? (
          <div className="movie-modal-status">
            <p className="status status--loading">Loading…</p>
          </div>
        ) : errMsg ? (
          <div className="movie-modal-status">
            <p className="status status--error">{errMsg}</p>
          </div>
        ) : !hasBody ? (
          <div className="movie-modal-status">
            <p className="status status--empty">No details available.</p>
          </div>
        ) : (
          <div className="movie-modal-body">
            <div className="movie-modal-layout">
              <div className="movie-modal-poster">
                <div className="movie-modal-poster-frame">
                  <MoviePoster src={posterUrl} alt={title} className="movie-modal-poster-img" />
                </div>
              </div>
              <div className="movie-modal-main">
                <p className="movie-modal-eyebrow">
                  {releaseYear}
                  {runtimeMinutes != null ? ` · ${runtimeMinutes} min` : ""}
                  {isCatalog && d?.imdbId ? ` · ${d.imdbId}` : ""}
                  {isCatalog && d?.tmdbId != null ? ` · TMDB ${d.tmdbId}` : ""}
                </p>
                <h2 id="movie-modal-title" className="movie-modal-title">
                  {title}
                </h2>
                {genres.length > 0 ? (
                  <ul className="movie-modal-genres">
                    {genres.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                ) : null}
                {directors.length > 0 ? (
                  <p className="movie-modal-directors">
                    <span className="movie-modal-label">Directed by</span> {directors.join(", ")}
                  </p>
                ) : null}
                {externalRatings.length > 0 ? (
                  <div className="movie-modal-ratings">
                    {externalRatings.map((er) => (
                      <div key={er.source} className="rating-pill rating-pill--compact">
                        <span className="rating-pill__source">{ratingLabel(er.source)}</span>
                        <span className="rating-pill__value">
                          {er.raw ?? (er.scale === 100 ? `${Math.round(er.value)}%` : `${er.value}/${er.scale}`)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {synopsis ? (
                  <div className="movie-modal-synopsis">
                    <h3>Synopsis</h3>
                    <div className="movie-modal-synopsis-body">
                      <p>{synopsis}</p>
                    </div>
                  </div>
                ) : null}

                {cast.length > 0 ? (
                  <div className="movie-modal-cast">
                    <h3>Cast</h3>
                    <ul className="movie-modal-cast-grid">
                      {(castExpanded ? cast.slice(0, 24) : cast.slice(0, 8)).map((c, i) => (
                        <li key={`${c.name}-${i}`} className="movie-modal-cast-cell">
                          <strong>{c.name}</strong>
                          {c.character ? <span className="movie-modal-cast-role">{c.character}</span> : null}
                        </li>
                      ))}
                    </ul>
                    {cast.length > 8 ? (
                      <button type="button" className="movie-modal-cast-toggle" onClick={() => setCastExpanded((v) => !v)}>
                        {castExpanded ? "Show fewer" : `Show all ${cast.length} cast credits`}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {isCatalog ? (
                  <div className="movie-modal-your-rating">
                    <h3>Your rating</h3>
                    {!token ? (
                      <p className="movie-modal-muted">Sign in once to submit a score. You only get one rating per movie.</p>
                    ) : userRating != null ? (
                      <p className="movie-modal-locked-score">
                        <strong>{userRating}</strong>/10 saved — personal ratings cannot be edited here.
                      </p>
                    ) : (
                      <form
                        key={catalogMovieId ?? "rating"}
                        className="movie-modal-rating-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          ratingMutation.mutate(ratingDraft);
                        }}
                      >
                        <label className="movie-modal-score-label">
                          Score (1–10): <strong className="movie-modal-score-value">{ratingDraft}</strong>
                          <input
                            type="range"
                            name="score"
                            min={1}
                            max={10}
                            step={1}
                            value={ratingDraft}
                            onChange={(e) => setRatingDraft(Number(e.target.value))}
                          />
                          <span className="movie-modal-score-hint">You can only submit once for this movie.</span>
                        </label>
                        <button type="submit" className="button button--gold movie-modal-submit-rating" disabled={ratingMutation.isPending}>
                          {ratingMutation.isPending ? "Saving…" : "Submit rating"}
                        </button>
                        {ratingMutation.isError ? (
                          <p className="status status--error">{(ratingMutation.error as Error).message}</p>
                        ) : null}
                      </form>
                    )}
                  </div>
                ) : (
                  <div className="movie-modal-preview-foot">
                    {!token ? (
                      <p className="movie-modal-muted">Sign in to import this title into your catalog and add a personal rating.</p>
                    ) : (
                      <div className="movie-modal-import-actions">
                        <button
                          type="button"
                          className="button button--gold movie-modal-submit-rating"
                          disabled={tmdbPreviewId == null || isImportDisabled(tmdbPreviewId)}
                          onClick={() => {
                            if (tmdbPreviewId != null) importTmdb(tmdbPreviewId);
                          }}
                        >
                          {tmdbPreviewId != null ? importLabel(tmdbPreviewId) : "Add to catalog"}
                        </button>
                        {tmdbPreviewId != null && getStatus(tmdbPreviewId) === "added" && addedMovie(tmdbPreviewId) ? (
                          <p className="status status--success">
                            Saved to your catalog. Cast and scores sync in the background.{" "}
                            <Link
                              to={`/movies/${addedMovie(tmdbPreviewId)!.id}`}
                              className="movie-modal-toolbar-link"
                              onClick={onClose}
                            >
                              Open movie page
                            </Link>
                          </p>
                        ) : null}
                        {tmdbPreviewId != null && importError(tmdbPreviewId) ? (
                          <p className="status status--error">{importError(tmdbPreviewId)}</p>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(ui, document.body);
}

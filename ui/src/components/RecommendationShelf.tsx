import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CatalogMovieCard } from "./CatalogMovieCard";
import { InlineState } from "./InlineState";
import { MovieDetailModal } from "./MovieDetailModal";
import { api } from "../lib/api";
import type { AuthState } from "../types/auth";

type DashboardRecDTO = {
  title: string;
  year?: number;
  movieId?: string;
  tmdbId?: number | null;
  posterUrl?: string | null;
  why: string;
};

type RecommendationResponseDTO = {
  recommendations: DashboardRecDTO[];
  disclaimer?: string;
};

type QuickRecView =
  | { kind: "catalog"; id: string }
  | { kind: "tmdb"; tmdbId: number };

type RecommendationShelfProps = {
  auth: AuthState | null;
  /** Visual style for heading (browse page uses `.shelf-heading`) */
  headingClassName?: string;
  heading?: string;
};

export function RecommendationShelf({
  auth,
  headingClassName = "section-title",
  heading = "Recommendations",
}: RecommendationShelfProps) {
  const token = auth?.token;
  const userId = auth?.user?.id;
  const qc = useQueryClient();
  const [quickRec, setQuickRec] = useState<QuickRecView | null>(null);

  const recs = useQuery({
    queryKey: ["recommendations", userId],
    queryFn: () =>
      api<RecommendationResponseDTO>("/api/ai/recommendations", { method: "POST", body: "{}" }, token),
    enabled: Boolean(token && userId),
  });

  const importMut = useMutation({
    mutationFn: (tmdbId: number) =>
      api<{ created: boolean; movie: { id: string; title: string } }>(
        "/api/movies/import/tmdb",
        { method: "POST", body: JSON.stringify({ tmdbId }) },
        token,
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["recommendations"] });
      await qc.invalidateQueries({ queryKey: ["search"] });
      await qc.invalidateQueries({ queryKey: ["movies-all"] });
      await qc.invalidateQueries({ queryKey: ["movies-catalog-home"] });
      await qc.invalidateQueries({ queryKey: ["collection"] });
    },
  });

  const items = recs.data?.recommendations ?? [];

  return (
    <>
      <MovieDetailModal
        auth={auth}
        open={quickRec !== null}
        onClose={() => setQuickRec(null)}
        catalogMovieId={quickRec?.kind === "catalog" ? quickRec.id : null}
        tmdbPreviewId={quickRec?.kind === "tmdb" ? quickRec.tmdbId : null}
      />

      <h2 className={headingClassName}>{heading}</h2>
      {recs.data?.disclaimer?.trim() ? (
        <p className="dashboard-rec-disclaimer" role="note">
          {recs.data.disclaimer}
        </p>
      ) : null}
      <InlineState
        loading={recs.isLoading}
        error={recs.error ? (recs.error as Error).message : undefined}
        hasData={items.length > 0}
        emptyText="No recommendations available yet."
      />
      <div className="catalog-grid dashboard-rec-grid">
        {items.map((r, i) => {
          const catalogHref = r.movieId ? `/movies/${r.movieId}` : undefined;
          const canModal = Boolean(r.movieId) || r.tmdbId != null;
          const showTmdbImport = r.tmdbId != null && !r.movieId;

          return (
            <CatalogMovieCard
              key={`reco-${r.movieId ?? (r.tmdbId != null ? `tmdb:${r.tmdbId}` : "na")}-${i}`}
              title={r.movieId ? r.title : r.year != null ? `${r.title} (${r.year})` : r.title}
              posterUrl={r.posterUrl ?? null}
              detailHref={catalogHref}
              onPosterClick={
                canModal
                  ? () => {
                      if (r.movieId) setQuickRec({ kind: "catalog", id: r.movieId });
                      else if (r.tmdbId != null) setQuickRec({ kind: "tmdb", tmdbId: r.tmdbId });
                    }
                  : undefined
              }
              footer={
                <div className="dashboard-rec-card-footer">
                  <p className="dashboard-rec-footer__why">{r.why}</p>
                  <div className="dashboard-rec-footer-slot p-2">
                    {showTmdbImport ? (
                      <>
                        <button
                          type="button"
                          className="button button--gold button--sm dashboard-rec-import-btn pt-2"
                          disabled={importMut.isPending || !token}
                          onClick={() => r.tmdbId != null && importMut.mutate(r.tmdbId)}
                        >
                          {!token ? "Sign in to import" : importMut.isPending ? "Adding…" : "Add to catalog"}
                        </button>
                        {importMut.isError && importMut.variables === r.tmdbId ? (
                          <p className="status status--error dashboard-rec-import-status">
                            {(importMut.error as Error).message}
                          </p>
                        ) : null}
                        {importMut.isSuccess && importMut.variables === r.tmdbId ? (
                          <p className="status status--success dashboard-rec-import-status">Added — refresh list or reopen details.</p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              }
            />
          );
        })}
      </div>
    </>
  );
}

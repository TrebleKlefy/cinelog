import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CatalogMovieCard } from "./CatalogMovieCard";
import { InlineState } from "./InlineState";
import { MovieDetailModal } from "./MovieDetailModal";
import { useTmdbCatalogImport } from "../hooks/useTmdbCatalogImport";
import { api } from "../lib/api";
import type { AuthState } from "../types/auth";

type DashboardRecDTO = {
  title: string;
  year?: number;
  tmdbId?: number | null;
  posterUrl?: string | null;
  why: string;
};

type RecommendationResponseDTO = {
  recommendations: DashboardRecDTO[];
  disclaimer?: string;
};

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
  const [tmdbPreviewId, setTmdbPreviewId] = useState<number | null>(null);
  const { importTmdb, importLabel, isImportDisabled, importError, getStatus } = useTmdbCatalogImport(token, userId);

  const recs = useQuery({
    queryKey: ["recommendations", userId],
    queryFn: () =>
      api<RecommendationResponseDTO>("/api/ai/recommendations", { method: "POST", body: "{}" }, token),
    enabled: Boolean(token && userId),
  });

  const items = (recs.data?.recommendations ?? []).filter((r) => r.tmdbId != null);

  return (
    <>
      <MovieDetailModal
        auth={auth}
        open={tmdbPreviewId != null}
        onClose={() => setTmdbPreviewId(null)}
        catalogMovieId={null}
        tmdbPreviewId={tmdbPreviewId}
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
          const tmdbId = r.tmdbId!;
          const cardTitle = r.year != null ? `${r.title} (${r.year})` : r.title;

          return (
            <CatalogMovieCard
              key={`reco-tmdb:${tmdbId}-${i}`}
              title={cardTitle}
              posterUrl={r.posterUrl ?? null}
              onPosterClick={() => setTmdbPreviewId(tmdbId)}
              footer={
                <div className="dashboard-rec-card-footer">
                  <p className="dashboard-rec-footer__why">{r.why}</p>
                  <div className="dashboard-rec-footer-slot p-2">
                    <button
                      type="button"
                      className="button button--gold button--sm dashboard-rec-import-btn pt-2"
                      disabled={isImportDisabled(tmdbId)}
                      onClick={() => importTmdb(tmdbId)}
                    >
                      {importLabel(tmdbId)}
                    </button>
                    {importError(tmdbId) ? (
                      <p className="status status--error dashboard-rec-import-status">{importError(tmdbId)}</p>
                    ) : null}
                    {getStatus(tmdbId) === "added" ? (
                      <p className="status status--success dashboard-rec-import-status">In your catalog — details sync in the background.</p>
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

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShareIcon } from "../../components/icons/ShareIcon";
import { ConfirmDialog, RemoveFromCatalogCopy, RemoveFromShelfCopy } from "../../components/ConfirmDialog";
import { CatalogMovieCard } from "../../components/CatalogMovieCard";
import { MovieDetailModal } from "../../components/MovieDetailModal";
import { InlineState } from "../../components/InlineState";
import { api } from "../../lib/api";
import type { ExternalRatingDTO } from "../../lib/movieDisplay";
import type { AuthState } from "../../types/auth";

export function CollectionPage({ auth }: { auth: AuthState }) {
  const token = auth?.token;
  const userId = auth?.user?.id;
  const qc = useQueryClient();
  const collection = useQuery({
    queryKey: ["collection", userId],
    queryFn: () =>
      api<{
        slug: string;
        title: string;
        isPublic: boolean;
        movies: Array<{
          movie: {
            id: string;
            title: string;
            posterUrl: string | null;
            releaseYear: number;
            imdbId: string | null;
            tmdbId: number | null;
            runtimeMinutes: number | null;
            externalRatings: ExternalRatingDTO[];
          };
        }>;
      }>("/api/me/collection", undefined, token),
    enabled: Boolean(token && userId),
  });
  const movies = useQuery({
    queryKey: ["movies-all", userId],
    queryFn: () =>
      api<{ items: Array<{ id: string; title: string; posterUrl: string | null; releaseYear: number; runtimeMinutes: number | null; externalRatings: ExternalRatingDTO[] }> }>(
        "/api/movies?page=1&pageSize=50",
        undefined,
        token,
      ),
    enabled: Boolean(token && userId),
  });
  const [movieId, setMovieId] = useState("");
  const [quickCatalogId, setQuickCatalogId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shelfRemoval, setShelfRemoval] = useState<{ movieId: string; title: string } | null>(null);
  const [catalogRemoval, setCatalogRemoval] = useState<{ movieId: string; title: string } | null>(null);

  const addMutation = useMutation({
    mutationFn: () => api("/api/me/collection/movies", { method: "POST", body: JSON.stringify({ movieId }) }, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collection"] }),
  });

  const patchCollection = useMutation({
    mutationFn: (body: { isPublic?: boolean; title?: string }) =>
      api<{ id: string; slug: string; title: string; isPublic: boolean }>(
        "/api/me/collection",
        { method: "PATCH", body: JSON.stringify(body) },
        token,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collection"] }),
  });

  const removeFromShelfMutation = useMutation({
    mutationFn: (movieId: string) => api<{ ok: boolean }>(`/api/me/collection/movies/${movieId}`, { method: "DELETE" }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collection"] });
      setShelfRemoval(null);
    },
  });

  const removeFromCatalogMutation = useMutation({
    mutationFn: (movieId: string) => api<{ ok: boolean }>(`/api/me/catalog/movies/${movieId}`, { method: "DELETE" }, token),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["movies-catalog-home"] });
      await qc.invalidateQueries({ queryKey: ["movies-all"] });
      await qc.invalidateQueries({ queryKey: ["collection"] });
      await qc.invalidateQueries({ queryKey: ["search"] });
      await qc.invalidateQueries({ queryKey: ["movie"] });
      await qc.invalidateQueries({ queryKey: ["movie-detail-modal"] });
      setCatalogRemoval(null);
    },
  });

  const existing = useMemo(() => new Set(collection.data?.movies.map((m) => m.movie.id) ?? []), [collection.data]);

  const shareUrl =
    typeof window !== "undefined" && collection.data?.slug
      ? `${window.location.origin}/collections/${encodeURIComponent(collection.data.slug)}`
      : "";

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="browse-page">
      <ConfirmDialog
        open={shelfRemoval !== null}
        title="Confirm removal from shelf"
        pending={removeFromShelfMutation.isPending}
        confirmLabel="Remove from shelf"
        destructive={false}
        onCancel={() => !removeFromShelfMutation.isPending && setShelfRemoval(null)}
        onConfirm={() => shelfRemoval != null && removeFromShelfMutation.mutate(shelfRemoval.movieId)}
      >
        {shelfRemoval ? <RemoveFromShelfCopy movieTitle={shelfRemoval.title} /> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={catalogRemoval !== null}
        title="Confirm removal from catalog"
        pending={removeFromCatalogMutation.isPending}
        confirmLabel="Remove from catalog"
        onCancel={() => !removeFromCatalogMutation.isPending && setCatalogRemoval(null)}
        onConfirm={() => catalogRemoval != null && removeFromCatalogMutation.mutate(catalogRemoval.movieId)}
      >
        {catalogRemoval ? <RemoveFromCatalogCopy movieTitle={catalogRemoval.title} /> : null}
      </ConfirmDialog>

      <MovieDetailModal
        auth={auth}
        open={quickCatalogId !== null}
        onClose={() => setQuickCatalogId(null)}
        catalogMovieId={quickCatalogId}
        tmdbPreviewId={null}
      />
      <header className="browse-masthead">
        <h1 className="browse-masthead__title browse-masthead__title--with-share">
          <ShareIcon className="browse-masthead__share-icon browse-masthead__share-icon--title" aria-hidden />
          My collection
        </h1>
        <p className="browse-masthead__lede">
          Build your watch shelf from your catalog—each poster has{" "}
          <strong>Remove from shelf</strong> (collection only) and <strong>Remove from catalog</strong> (hides everywhere and clears your rating). Turn on{" "}
          <strong>a public link</strong>{" "}
          below to share read-only shelf access without asking friends to mirror your imports.
        </p>
      </header>

      <section className="browse-shelf browse-shelf--connect">
        <div className="browse-shelf__inner">
          {removeFromShelfMutation.isError || removeFromCatalogMutation.isError ? (
            <p className="status status--error browse-shelf__hint">
              {((removeFromShelfMutation.error ?? removeFromCatalogMutation.error) as Error).message}
            </p>
          ) : null}
          {collection.data ? (
            <>
              <h2 className="shelf-heading shelf-heading--with-share">
                <ShareIcon className="shelf-heading__share-icon" width={15} height={15} aria-hidden />
                Sharing
              </h2>
              <p className="browse-shelf__hint collection-share-hint">
                When public, anyone with your link sees this shelf (no login required). Poster opens a TMDB synopsis preview.
              </p>
              <label className="collection-share-toggle field field--on-dark">
                <input
                  type="checkbox"
                  className="collection-share-toggle__input"
                  checked={collection.data.isPublic}
                  disabled={patchCollection.isPending}
                  onChange={(e) => patchCollection.mutate({ isPublic: e.target.checked })}
                />
                <span>Anyone with the link can view this collection (read-only)</span>
              </label>
              {patchCollection.isError ? (
                <p className="status status--error">{(patchCollection.error as Error).message}</p>
              ) : null}
              {collection.data.isPublic && shareUrl ? (
                <div className="collection-share-url-row">
                  <label className="field field--on-dark collection-share-url-field">
                    <span>Share URL</span>
                    <input readOnly value={shareUrl} aria-readonly />
                  </label>
                  <div className="collection-share-actions">
                    <button type="button" className="button button--secondary button--sm" onClick={() => void copyShareLink()}>
                      {copied ? "Copied" : "Copy link"}
                    </button>
                    <a className="button button--gold button--sm" href={shareUrl} target="_blank" rel="noopener noreferrer">
                      Preview
                    </a>
                  </div>
                </div>
              ) : null}
              <div className="collection-share-divider" role="presentation" />
            </>
          ) : null}

          <h2 className="shelf-heading">Add to shelf</h2>
          <div className="row row--shelf">
            <select value={movieId} onChange={(e) => setMovieId(e.target.value)}>
              <option value="">Select a movie</option>
              {movies.data?.items.map((m) => (
                <option key={m.id} value={m.id} disabled={existing.has(m.id)}>
                  {m.title}
                </option>
              ))}
            </select>
            <button type="button" className="button button--gold" disabled={!movieId || addMutation.isPending} onClick={() => addMutation.mutate()}>
              {addMutation.isPending ? "Adding…" : "Add"}
            </button>
          </div>

          <h2 className="shelf-heading shelf-heading--secondary">On your shelf</h2>
          <InlineState
            loading={collection.isLoading || movies.isLoading}
            error={(collection.error as Error | null)?.message ?? (movies.error as Error | null)?.message ?? undefined}
            hasData={Boolean(collection.data?.movies?.length)}
            emptyText="Nothing here yet. Import from Search or pick a title above."
          />
          <div className="catalog-grid">
            {collection.data?.movies.map((m) => (
              <CatalogMovieCard
                key={m.movie.id}
                detailHref={`/movies/${m.movie.id}`}
                onPosterClick={() => setQuickCatalogId(m.movie.id)}
                title={m.movie.title}
                posterUrl={m.movie.posterUrl}
                runtimeMinutes={m.movie.runtimeMinutes}
                externalRatings={m.movie.externalRatings}
                footer={
                  <div className="catalog-card-remove-btn-row">
                    <button
                      type="button"
                      className="catalog-card-remove-btn catalog-card-remove-btn--subtle"
                      disabled={removeFromShelfMutation.isPending || removeFromCatalogMutation.isPending}
                      onClick={() => setShelfRemoval({ movieId: m.movie.id, title: m.movie.title })}
                    >
                      {removeFromShelfMutation.isPending ? "Removing…" : "Remove from shelf"}
                    </button>
                    <button
                      type="button"
                      className="catalog-card-remove-btn"
                      disabled={removeFromShelfMutation.isPending || removeFromCatalogMutation.isPending}
                      onClick={() => setCatalogRemoval({ movieId: m.movie.id, title: m.movie.title })}
                    >
                      {removeFromCatalogMutation.isPending ? "Removing…" : "Remove from catalog"}
                    </button>
                  </div>
                }
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

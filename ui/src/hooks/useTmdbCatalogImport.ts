import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export type TmdbImportStatus = "idle" | "adding" | "added" | "error";

type ImportResponse = {
  created: boolean;
  enrichment: "pending";
  movie: { id: string; title: string };
};

const ENRICHMENT_REFRESH_MS = 12_000;

async function invalidateAfterImport(qc: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["recommendations"] }),
    qc.invalidateQueries({ queryKey: ["search"] }),
    qc.invalidateQueries({ queryKey: ["movies-all"] }),
    qc.invalidateQueries({ queryKey: ["movies-catalog-home"] }),
    qc.invalidateQueries({ queryKey: ["catalog-tmdb-ids"] }),
    qc.invalidateQueries({ queryKey: ["tmdb-browse"] }),
    qc.invalidateQueries({ queryKey: ["collection"] }),
  ]);
}

export function useTmdbCatalogImport(token?: string, userId?: string) {
  const qc = useQueryClient();
  const [statusByTmdbId, setStatusByTmdbId] = useState<Record<number, TmdbImportStatus>>({});
  const [errorByTmdbId, setErrorByTmdbId] = useState<Record<number, string>>({});
  const [addedMovieByTmdbId, setAddedMovieByTmdbId] = useState<Record<number, { id: string; title: string }>>({});

  const catalogIdsQ = useQuery({
    queryKey: ["catalog-tmdb-ids", userId],
    queryFn: () => api<{ tmdbIds: number[] }>("/api/me/catalog/tmdb-ids", undefined, token),
    enabled: Boolean(token && userId),
    staleTime: 60_000,
  });

  const catalogTmdbIds = useMemo(() => new Set(catalogIdsQ.data?.tmdbIds ?? []), [catalogIdsQ.data]);

  const resolveStatus = useCallback(
    (tmdbId: number): TmdbImportStatus => {
      const local = statusByTmdbId[tmdbId];
      if (local === "adding" || local === "error") return local;
      if (local === "added" || catalogTmdbIds.has(tmdbId)) return "added";
      return "idle";
    },
    [statusByTmdbId, catalogTmdbIds],
  );

  const importMut = useMutation({
    mutationFn: (tmdbId: number) =>
      api<ImportResponse>("/api/movies/import/tmdb", { method: "POST", body: JSON.stringify({ tmdbId }) }, token),
    onMutate: (tmdbId) => {
      setStatusByTmdbId((prev) => ({ ...prev, [tmdbId]: "adding" }));
      setErrorByTmdbId((prev) => {
        const next = { ...prev };
        delete next[tmdbId];
        return next;
      });
    },
    onSuccess: async (data, tmdbId) => {
      setStatusByTmdbId((prev) => ({ ...prev, [tmdbId]: "added" }));
      setAddedMovieByTmdbId((prev) => ({ ...prev, [tmdbId]: data.movie }));
      await invalidateAfterImport(qc);
      window.setTimeout(() => {
        void invalidateAfterImport(qc);
      }, ENRICHMENT_REFRESH_MS);
    },
    onError: (err, tmdbId) => {
      setStatusByTmdbId((prev) => ({ ...prev, [tmdbId]: "error" }));
      setErrorByTmdbId((prev) => ({ ...prev, [tmdbId]: (err as Error).message }));
    },
  });

  const getStatus = useCallback((tmdbId: number) => resolveStatus(tmdbId), [resolveStatus]);

  const importLabel = useCallback(
    (tmdbId: number) => {
      if (!token) return "Sign in to import";
      const status = resolveStatus(tmdbId);
      if (status === "adding") return "Adding…";
      if (status === "added") return "Added";
      if (status === "error") return "Retry";
      return "Add to catalog";
    },
    [resolveStatus, token],
  );

  const isImportDisabled = useCallback(
    (tmdbId: number) => !token || resolveStatus(tmdbId) === "adding" || resolveStatus(tmdbId) === "added",
    [resolveStatus, token],
  );

  const importError = useCallback((tmdbId: number) => errorByTmdbId[tmdbId], [errorByTmdbId]);

  const addedMovie = useCallback((tmdbId: number) => addedMovieByTmdbId[tmdbId], [addedMovieByTmdbId]);

  return {
    importTmdb: importMut.mutate,
    getStatus,
    importLabel,
    isImportDisabled,
    importError,
    addedMovie,
  };
}

export type ExternalRatingDTO = { source: string; value: number; scale: number; raw: string | null };

/** IMDb-style score 0–10 from our `ExternalRatingSource.IMDB` rows. */
export function getImdbScore(ratings: ExternalRatingDTO[] | undefined): number | null {
  const r = ratings?.find((x) => x.source === "IMDB");
  return r != null ? r.value : null;
}

/** Badge score on catalog cards: IMDb 0–10 when present; else TMDB 0–10. */
export function getCatalogBadgeScore(ratings: ExternalRatingDTO[] | undefined): number | null {
  const imdb = ratings?.find((x) => x.source === "IMDB");
  if (imdb && imdb.scale === 10 && Number.isFinite(imdb.value)) return imdb.value;
  const tmdb = ratings?.find((x) => x.source === "TMDB");
  if (tmdb && tmdb.scale === 10 && Number.isFinite(tmdb.value)) return tmdb.value;
  return null;
}

/** Rotten Tomatoes critic score 0–100 when stored from OMDb import. */
export function getRottenTomatoesPercent(ratings: ExternalRatingDTO[] | undefined): number | null {
  const rt = ratings?.find((x) => x.source === "ROTTEN_TOMATOES");
  if (rt == null || rt.scale !== 100 || !Number.isFinite(rt.value)) return null;
  return rt.value;
}

export function rtBadgeTier(percent: number): "high" | "mid" | "low" {
  if (percent >= 70) return "high";
  if (percent >= 50) return "mid";
  return "low";
}

export function formatRuntimeMinutes(min: number | null | undefined): string | null {
  if (min == null || min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

/** Match common streaming badges: green ≥7, orange ≥6, else muted. */
export function imdbBadgeTier(score: number): "high" | "mid" | "low" {
  if (score >= 7) return "high";
  if (score >= 6) return "mid";
  return "low";
}

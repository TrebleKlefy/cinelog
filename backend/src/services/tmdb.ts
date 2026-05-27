const TMDB_V3_BASE = "https://api.themoviedb.org/3";
const IMG_W500_BASE = "https://image.tmdb.org/t/p/w500";

/** Prefer v4 read-access JWT (Bearer); otherwise v3 api_key query param. See https://developer.themoviedb.org/docs/getting-started */
function assertTmdbConfigured(): void {
  const bearer = process.env.TMDB_READ_ACCESS_TOKEN?.trim();
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (!bearer && !apiKey) {
    const err = new Error(
      "TMDB is not configured: set TMDB_READ_ACCESS_TOKEN (Bearer) or TMDB_API_KEY (v3 query param)",
    ) as Error & { status?: number };
    err.status = 503;
    throw err;
  }
}

async function tmdbFetchJson<T>(path: string, searchParams?: Record<string, string>): Promise<T> {
  assertTmdbConfigured();
  const bearer = process.env.TMDB_READ_ACCESS_TOKEN?.trim();
  const headers: { Authorization: string } | undefined = bearer ? { Authorization: `Bearer ${bearer}` } : undefined;

  const url = new URL(`${TMDB_V3_BASE}${path}`);
  if (!headers) {
    const apiKey = process.env.TMDB_API_KEY!.trim();
    url.searchParams.set("api_key", apiKey);
  }
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, headers ? { headers } : undefined);
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`TMDB error ${res.status}: ${text.slice(0, 200)}`) as Error & { status?: number };
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const err = new Error("TMDB returned non-JSON") as Error & { status?: number };
    err.status = 502;
    throw err;
  }
}

export function tmdbPosterUrl(posterPath: string | null | undefined): string | null {
  if (!posterPath) return null;
  return `${IMG_W500_BASE}${posterPath.startsWith("/") ? posterPath : `/${posterPath}`}`;
}

type TmdbMovieSearchRow = {
  id: number;
  title?: string;
  poster_path?: string | null;
  release_date?: string | null;
  vote_average?: number | null;
};

type TmdbSearchResponse = {
  page: number;
  total_pages: number;
  total_results: number;
  results: TmdbMovieSearchRow[];
};

export type TmdbMovieBrowseItem = {
  tmdbId: number;
  title: string;
  releaseYear: number | null;
  posterUrl: string | null;
  voteAverage: number | null;
};

function mapDiscoverRows(rows: TmdbMovieSearchRow[]): TmdbMovieBrowseItem[] {
  return rows
    .filter((r): r is TmdbMovieSearchRow & { id: number } => typeof r?.id === "number")
    .map((row) => {
      const ry = row.release_date?.trim().slice(0, 4);
      const releaseYear = ry && /^\d{4}$/.test(ry) ? Number(ry) : null;
      return {
        tmdbId: row.id,
        title: row.title ?? "Untitled",
        releaseYear,
        posterUrl: tmdbPosterUrl(row.poster_path),
        voteAverage:
          typeof row.vote_average === "number" && Number.isFinite(row.vote_average) ? row.vote_average : null,
      };
    });
}

function discoverPayloadFrom(raw: TmdbSearchResponse): {
  total: number;
  page: number;
  pages: number;
  items: TmdbMovieBrowseItem[];
} {
  return {
    total: raw.total_results,
    page: raw.page,
    pages: raw.total_pages,
    items: mapDiscoverRows(raw.results),
  };
}

export async function tmdbSearchMovies(query: string, page = 1): Promise<{
  total: number;
  page: number;
  pages: number;
  items: TmdbMovieBrowseItem[];
}> {
  const raw = await tmdbFetchJson<TmdbSearchResponse>("/search/movie", {
    query: query.trim(),
    page: String(page),
    include_adult: "false",
    language: "en-US",
  });
  return discoverPayloadFrom(raw);
}

/** Poster grid default: TMDB trending (day or week window). Same item shape as search. */
export async function tmdbTrendingMovies(window: "day" | "week", page = 1): Promise<{
  total: number;
  page: number;
  pages: number;
  items: TmdbMovieBrowseItem[];
}> {
  const raw = await tmdbFetchJson<TmdbSearchResponse>(`/trending/movie/${window}`, {
    page: String(page),
    language: "en-US",
  });
  return discoverPayloadFrom(raw);
}

/** TMDB curated lists — same movie row shape as search/trending. */
export async function tmdbMovieBrowseList(
  list: "top_rated" | "now_playing",
  page = 1,
): Promise<{ total: number; page: number; pages: number; items: TmdbMovieBrowseItem[] }> {
  const raw = await tmdbFetchJson<TmdbSearchResponse>(`/movie/${list}`, {
    page: String(page),
    language: "en-US",
    region: "US",
  });
  return discoverPayloadFrom(raw);
}

/** Merge successive TMDB API pages until `[start,end)` is filled or API exhausted. Dedup by tmdbId. */
async function tmdbAccumulatePaged(
  fetchBatch: (apiPage: number) => Promise<{ items: TmdbMovieBrowseItem[]; apiTotalResults: number; apiTotalPages: number }>,
  uiPage: number,
  pageSize: number,
): Promise<{ total: number; page: number; pages: number; pageSize: number; items: TmdbMovieBrowseItem[] }> {
  const clampedUiPage = Math.max(1, Math.floor(uiPage));
  const safeSize = Math.min(Math.max(pageSize, 1), 50);
  const start = (clampedUiPage - 1) * safeSize;
  const end = start + safeSize;

  const merged: TmdbMovieBrowseItem[] = [];
  const seen = new Set<number>();

  let apiTotalResults = 0;
  let apiTotalPages = Number.POSITIVE_INFINITY;
  let seeded = false;

  for (
    let apiPage = 1;
    merged.length < end && apiPage <= apiTotalPages && apiPage <= 200;
    apiPage += 1
  ) {
    const batch = await fetchBatch(apiPage);
    if (!seeded) {
      apiTotalResults = batch.apiTotalResults;
      apiTotalPages = Math.max(1, Math.min(batch.apiTotalPages, 500));
      seeded = true;
    }
    for (const it of batch.items) {
      if (seen.has(it.tmdbId)) continue;
      seen.add(it.tmdbId);
      merged.push(it);
      if (merged.length >= end) break;
    }
  }

  const items = merged.slice(start, end);
  const pages = Math.max(1, Math.ceil(apiTotalResults / safeSize));

  return {
    total: apiTotalResults,
    pages,
    page: clampedUiPage,
    pageSize: safeSize,
    items,
  };
}

/** UI-sized page into TMDB trending (TMDB ships ~20 per API page — we fuse pages for 28+). */
export async function tmdbTrendingForUiPage(
  window: "day" | "week",
  uiPage: number,
  pageSize: number,
): Promise<{ total: number; page: number; pages: number; pageSize: number; items: TmdbMovieBrowseItem[] }> {
  const fetchBatch = async (apiPage: number) => {
    const r = await tmdbTrendingMovies(window, apiPage);
    return {
      items: r.items,
      apiTotalResults: r.total,
      apiTotalPages: r.pages,
    };
  };
  return tmdbAccumulatePaged(fetchBatch, uiPage, pageSize);
}

/** UI-sized slice for TMDB search. */
export async function tmdbSearchForUiPage(
  query: string,
  uiPage: number,
  pageSize: number,
): Promise<{ total: number; page: number; pages: number; pageSize: number; items: TmdbMovieBrowseItem[] }> {
  const fetchBatch = async (apiPage: number) => {
    const r = await tmdbSearchMovies(query, apiPage);
    return {
      items: r.items,
      apiTotalResults: r.total,
      apiTotalPages: r.pages,
    };
  };
  return tmdbAccumulatePaged(fetchBatch, uiPage, pageSize);
}

type TmdbGenreListResponse = {
  genres: Array<{ id: number; name: string }>;
};

type TmdbPersonSearchRow = {
  id: number;
  name?: string;
  known_for_department?: string;
};

type TmdbPersonSearchResponse = {
  results: TmdbPersonSearchRow[];
};

let tmdbGenreList: Array<{ id: number; name: string }> | null = null;

async function ensureTmdbGenreList(): Promise<void> {
  if (tmdbGenreList) return;
  const raw = await tmdbFetchJson<TmdbGenreListResponse>("/genre/movie/list", {
    language: "en-US",
  });
  tmdbGenreList = raw.genres ?? [];
}

async function tmdbGenreIdByName(name: string): Promise<number | null> {
  await ensureTmdbGenreList();
  const match = tmdbGenreList!.find((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase());
  return match?.id ?? null;
}

export async function tmdbMovieGenreNames(): Promise<string[]> {
  await ensureTmdbGenreList();
  return tmdbGenreList!.map((g) => g.name).sort((a, b) => a.localeCompare(b));
}

async function tmdbPersonIdByName(name: string, department?: string): Promise<number | null> {
  const raw = await tmdbFetchJson<TmdbPersonSearchResponse>("/search/person", {
    query: name.trim(),
    page: "1",
    include_adult: "false",
  });
  const rows = raw.results ?? [];
  if (rows.length === 0) return null;
  if (department) {
    const deptMatch = rows.find((r) => r.known_for_department === department);
    if (deptMatch?.id) return deptMatch.id;
  }
  return rows[0]?.id ?? null;
}

async function tmdbDiscoverMovies(
  page: number,
  filters: { genreId?: number; castId?: number; crewId?: number },
): Promise<{ total: number; page: number; pages: number; items: TmdbMovieBrowseItem[] }> {
  const params: Record<string, string> = {
    page: String(page),
    language: "en-US",
    sort_by: "popularity.desc",
    include_adult: "false",
  };
  if (filters.genreId != null) params.with_genres = String(filters.genreId);
  if (filters.castId != null) params.with_cast = String(filters.castId);
  if (filters.crewId != null) params.with_crew = String(filters.crewId);

  const raw = await tmdbFetchJson<TmdbSearchResponse>("/discover/movie", params);
  return discoverPayloadFrom(raw);
}

function emptyUiPage(uiPage: number, pageSize: number) {
  return {
    total: 0,
    page: uiPage,
    pages: 1,
    pageSize,
    items: [] as TmdbMovieBrowseItem[],
  };
}

/** TMDB browse for Discover UI: trending, title search, and/or cast/director/genre filters. */
export async function tmdbBrowseForUiPage(opts: {
  q?: string;
  cast?: string;
  director?: string;
  genre?: string;
  uiPage: number;
  pageSize: number;
}): Promise<{ total: number; page: number; pages: number; pageSize: number; items: TmdbMovieBrowseItem[] }> {
  const q = opts.q?.trim() ?? "";
  const cast = opts.cast?.trim() ?? "";
  const director = opts.director?.trim() ?? "";
  const genre = opts.genre?.trim() ?? "";
  const hasSubFilters = Boolean(cast || director || genre);
  const hasQuery = q.length >= 2;

  if (!hasSubFilters && !hasQuery) {
    return tmdbTrendingForUiPage("week", opts.uiPage, opts.pageSize);
  }

  if (!hasSubFilters && hasQuery) {
    return tmdbSearchForUiPage(q, opts.uiPage, opts.pageSize);
  }

  const [genreId, castId, crewId] = await Promise.all([
    genre ? tmdbGenreIdByName(genre) : Promise.resolve(null),
    cast ? tmdbPersonIdByName(cast, "Acting") : Promise.resolve(null),
    director ? tmdbPersonIdByName(director, "Directing") : Promise.resolve(null),
  ]);

  if (genre && genreId == null) return emptyUiPage(opts.uiPage, opts.pageSize);
  if (cast && castId == null) return emptyUiPage(opts.uiPage, opts.pageSize);
  if (director && crewId == null) return emptyUiPage(opts.uiPage, opts.pageSize);

  const fetchBatch = async (apiPage: number) => {
    const r = await tmdbDiscoverMovies(apiPage, {
      genreId: genreId ?? undefined,
      castId: castId ?? undefined,
      crewId: crewId ?? undefined,
    });
    let items = r.items;
    if (hasQuery) {
      const needle = q.toLowerCase();
      items = items.filter((it) => it.title.toLowerCase().includes(needle));
    }
    return {
      items,
      apiTotalResults: hasQuery ? items.length : r.total,
      apiTotalPages: r.pages,
    };
  };

  return tmdbAccumulatePaged(fetchBatch, opts.uiPage, opts.pageSize);
}


export type TmdbMovieQuickImported = {
  tmdbId: number;
  imdbId: string | null;
  title: string;
  releaseYear: number;
  runtimeMinutes: number | null;
  synopsis: string | null;
  posterUrl: string | null;
  genreNames: string[];
  tmdbVoteAverage: number | null;
};

export type TmdbMovieDetailImported = TmdbMovieQuickImported & {
  directors: string[];
  cast: Array<{ name: string; character: string | null }>;
};

/** Append fields become top-level siblings on TMDB GET /movie/{id}. */
type TmdbMovieDetailResponse = {
  id: number;
  title: string;
  overview: string | null;
  runtime: number | null;
  release_date?: string | null;
  poster_path?: string | null;
  genres?: Array<{ id: number; name: string }>;
  vote_average?: number | null;
  credits?: {
    cast?: Array<{ name: string; character?: string | null }>;
    crew?: Array<{ name: string; job?: string }>;
  };
  external_ids?: { imdb_id?: string | null };
};

function parseReleaseYearFromTmdb(date: string | null | undefined): number {
  const s = date?.trim();
  if (!s) {
    const err = new Error("TMDB movie has no release_date — cannot derive release year.") as Error & { status?: number };
    err.status = 422;
    throw err;
  }
  const y = s.slice(0, 4);
  if (!/^\d{4}$/.test(y)) {
    const err = new Error(`Could not parse release year from TMDB date: "${s}"`) as Error & { status?: number };
    err.status = 422;
    throw err;
  }
  return Number(y);
}

function normalizeExternalImdbId(raw: unknown): string | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const normalized = /^tt\d+$/i.test(s) ? s.toLowerCase() : /^\d+$/.test(s) ? `tt${s}` : s.toLowerCase();
  return /^tt\d+$/.test(normalized) ? normalized : null;
}

function parseTmdbMovieQuickFields(data: TmdbMovieDetailResponse): TmdbMovieQuickImported {
  const imdbId = normalizeExternalImdbId(data.external_ids?.imdb_id);
  const releaseYear = parseReleaseYearFromTmdb(data.release_date ?? null);
  const genres = data.genres?.map((g) => g.name.trim()).filter(Boolean) ?? [];
  const synopsis = data.overview?.trim() ? data.overview.trim() : null;
  const runtimeMinutes =
    typeof data.runtime === "number" && data.runtime > 0 ? Math.floor(data.runtime) : null;
  const voteAvg =
    typeof data.vote_average === "number" && Number.isFinite(data.vote_average) ? data.vote_average : null;

  return {
    tmdbId: data.id,
    imdbId,
    title: data.title?.trim() ? data.title.trim() : "Untitled",
    releaseYear,
    runtimeMinutes,
    synopsis,
    posterUrl: tmdbPosterUrl(data.poster_path),
    genreNames: genres,
    tmdbVoteAverage: voteAvg,
  };
}

/** Lightweight TMDB fetch for instant catalog adds (no credits). */
export async function tmdbFetchMovieQuickPayload(tmdbId: number): Promise<TmdbMovieQuickImported> {
  const data = await tmdbFetchJson<TmdbMovieDetailResponse>(`/movie/${tmdbId}`, {
    append_to_response: "external_ids",
    language: "en-US",
  });
  return parseTmdbMovieQuickFields(data);
}

export async function tmdbFetchMovieImportPayload(tmdbId: number): Promise<TmdbMovieDetailImported> {
  const data = await tmdbFetchJson<TmdbMovieDetailResponse>(`/movie/${tmdbId}`, {
    append_to_response: "credits,external_ids",
    language: "en-US",
  });

  const quick = parseTmdbMovieQuickFields(data);

  const directors =
    data.credits?.crew
      ?.filter((c) => c.job === "Director" && (c.name?.trim()?.length ?? 0) > 0)
      .map((c) => c.name.trim()) ?? [];

  const uniqueDirectors = [...new Set(directors)];

  const castMembers =
    data.credits?.cast
      ?.filter((c) => (c.name?.trim()?.length ?? 0) > 0)
      .slice(0, 15)
      .map((c) => ({
        name: c.name.trim(),
        character: c.character?.trim() ? c.character.trim() : null,
      })) ?? [];

  return {
    ...quick,
    directors: uniqueDirectors,
    cast: castMembers,
  };
}

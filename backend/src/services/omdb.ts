import { z } from "zod";

const OMDB_BASE = "https://www.omdbapi.com/";

function requireOmdbApiKey(): string {
  const key = process.env.OMDB_API_KEY?.trim();
  if (!key) {
    const err = new Error("OMDb is not configured (set OMDB_API_KEY in .env)") as Error & { status: number };
    err.status = 503;
    throw err;
  }
  return key;
}

const searchOk = z.object({
  Response: z.literal("True"),
  Search: z.array(
    z.object({
      Title: z.string(),
      Year: z.string(),
      imdbID: z.string(),
      Type: z.string(),
      Poster: z.string(),
    }),
  ),
  totalResults: z.string().optional(),
});

const searchErr = z.object({
  Response: z.literal("False"),
  Error: z.string(),
});

const searchResponseSchema = z.union([searchOk, searchErr]);

export async function omdbSearch(input: { query: string; page: number }): Promise<{
  total: number;
  page: number;
  items: Array<{
    title: string;
    year: string;
    imdbId: string;
    type: string;
    posterUrl: string | null;
  }>;
}> {
  const key = requireOmdbApiKey();
  const url = new URL(OMDB_BASE);
  url.searchParams.set("apikey", key);
  url.searchParams.set("s", input.query);
  url.searchParams.set("page", String(input.page));

  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`OMDb HTTP error (${res.status})`) as Error & { status: number };
    err.status = 502;
    throw err;
  }

  const raw: unknown = await res.json();
  const parsed = searchResponseSchema.safeParse(raw);
  if (!parsed.success) {
    const err = new Error("OMDb returned an unexpected response shape") as Error & { status: number };
    err.status = 502;
    throw err;
  }

  const body = parsed.data;
  if (body.Response === "False") {
    const msg = body.Error.toLowerCase();
    if (msg.includes("not found") || msg.includes("no results")) {
      return { total: 0, page: input.page, items: [] };
    }
    const err = new Error(body.Error) as Error & { status: number };
    err.status = 502;
    throw err;
  }

  const total = Number(body.totalResults) || body.Search.length;

  return {
    total,
    page: input.page,
    items: body.Search.map((row) => ({
      title: row.Title,
      year: row.Year,
      imdbId: row.imdbID,
      type: row.Type,
      posterUrl: row.Poster === "N/A" ? null : row.Poster,
    })),
  };
}

const detailOk = z.object({
  Response: z.literal("True"),
  imdbID: z.string(),
  Title: z.string(),
  Year: z.string(),
  Type: z.string(),
  Poster: z.string().optional(),
  Plot: z.string().optional(),
  Runtime: z.string().optional(),
  Genre: z.string().optional(),
  Director: z.string().optional(),
  Actors: z.string().optional(),
  imdbRating: z.string().optional(),
  Ratings: z
    .array(
      z.object({
        Source: z.string(),
        Value: z.string(),
      }),
    )
    .optional(),
});

const detailErr = z.object({
  Response: z.literal("False"),
  Error: z.string(),
});

const detailResponseSchema = z.union([detailOk, detailErr]);

function parseRottenTomatoesPercent(
  ratings: Array<{ Source: string; Value: string }> | undefined,
): number | null {
  if (!ratings?.length) return null;
  const row = ratings.find((r) => r.Source.toLowerCase().includes("rotten tomato"));
  if (!row?.Value) return null;
  const m = row.Value.match(/(\d+)\s*%/);
  if (m) return Number(m[1]);
  const n = Number(row.Value.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function omdbGetByImdbId(imdbId: string): Promise<{
  imdbId: string;
  title: string;
  year: string;
  type: string;
  posterUrl: string | null;
  plot: string | null;
  runtime: string | null;
  genre: string | null;
  imdbRating: number | null;
  rottenTomatoesPercent: number | null;
  director: string | null;
  actors: string | null;
}> {
  const key = requireOmdbApiKey();
  const url = new URL(OMDB_BASE);
  url.searchParams.set("apikey", key);
  url.searchParams.set("i", imdbId);
  url.searchParams.set("plot", "short");
  url.searchParams.set("tomatoes", "true");

  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`OMDb HTTP error (${res.status})`) as Error & { status: number };
    err.status = 502;
    throw err;
  }

  const raw: unknown = await res.json();
  const parsed = detailResponseSchema.safeParse(raw);
  if (!parsed.success) {
    const err = new Error("OMDb returned an unexpected response shape") as Error & { status: number };
    err.status = 502;
    throw err;
  }

  const body = parsed.data;
  if (body.Response === "False") {
    const err = new Error(body.Error) as Error & { status: number };
    err.status = 404;
    throw err;
  }

  const ratingRaw = body.imdbRating;
  const imdbRating =
    ratingRaw && ratingRaw !== "N/A" && !Number.isNaN(Number(ratingRaw)) ? Number(ratingRaw) : null;

  const rottenTomatoesPercent = parseRottenTomatoesPercent(body.Ratings);

  return {
    imdbId: body.imdbID,
    title: body.Title,
    year: body.Year,
    type: body.Type,
    posterUrl: !body.Poster || body.Poster === "N/A" ? null : body.Poster,
    plot: !body.Plot || body.Plot === "N/A" ? null : body.Plot,
    runtime: !body.Runtime || body.Runtime === "N/A" ? null : body.Runtime,
    genre: !body.Genre || body.Genre === "N/A" ? null : body.Genre,
    imdbRating,
    rottenTomatoesPercent,
    director: !body.Director || body.Director === "N/A" ? null : body.Director,
    actors: !body.Actors || body.Actors === "N/A" ? null : body.Actors,
  };
}

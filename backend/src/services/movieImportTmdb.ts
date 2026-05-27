import type { Prisma } from "@prisma/client";
import { ExternalRatingSource } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { omdbGetByImdbId } from "./omdb.js";
import { tmdbFetchMovieImportPayload, tmdbFetchMovieQuickPayload, type TmdbMovieQuickImported } from "./tmdb.js";

/** Prisma default interactive tx timeout (5s) is too tight for cast/director linking. */
const ENRICH_TX_TIMEOUT_MS = 30_000;
const QUICK_TX_TIMEOUT_MS = 10_000;

export type MovieImportResult = {
  created: boolean;
  movie: {
    id: string;
    imdbId: string | null;
    tmdbId: number | null;
    title: string;
    releaseYear: number;
    runtimeMinutes: number | null;
    synopsis: string | null;
    posterUrl: string | null;
  };
};

type MovieTx = Prisma.TransactionClient;

type OmdbRatingSnapshot = {
  imdbRating: number | null;
  rottenTomatoesPercent: number | null;
};

function assertValidTmdbId(tmdbIdInput: number): void {
  if (!Number.isInteger(tmdbIdInput) || tmdbIdInput < 1) {
    const err = new Error("tmdbId must be a positive integer") as Error & { status?: number };
    err.status = 400;
    throw err;
  }
}

async function findOrCreatePersonId(name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = await prisma.person.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } },
  });
  if (existing) return existing.id;
  const created = await prisma.person.create({ data: { name: trimmed } });
  return created.id;
}

async function resolvePersonIdMap(names: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (name) => {
      const id = await findOrCreatePersonId(name);
      return id ? ([name.toLowerCase(), id] as const) : null;
    }),
  );
  return new Map(entries.filter((e): e is readonly [string, string] => e != null));
}

function personIdFromMap(map: Map<string, string>, name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return map.get(trimmed.toLowerCase()) ?? null;
}

async function upsertMovieGenres(tx: MovieTx, movieId: string, genreNames: string[]): Promise<void> {
  await tx.movieGenre.deleteMany({ where: { movieId } });
  for (const genreName of genreNames) {
    const genre = await tx.genre.upsert({
      where: { name: genreName },
      create: { name: genreName },
      update: {},
    });
    await tx.movieGenre.create({
      data: { movieId, genreId: genre.id },
    });
  }
}

async function upsertTmdbRating(tx: MovieTx, movieId: string, tmdbVoteAverage: number | null): Promise<void> {
  if (tmdbVoteAverage != null) {
    const val = Number(tmdbVoteAverage.toFixed(1));
    await tx.movieExternalRating.upsert({
      where: {
        movieId_source: { movieId, source: ExternalRatingSource.TMDB },
      },
      create: {
        movieId,
        source: ExternalRatingSource.TMDB,
        ratingValue: val,
        ratingScale: 10,
        ratingRaw: `${val}/10`,
      },
      update: {
        ratingValue: val,
        ratingScale: 10,
        ratingRaw: `${val}/10`,
      },
    });
  } else {
    await tx.movieExternalRating.deleteMany({
      where: { movieId, source: ExternalRatingSource.TMDB },
    });
  }
}

async function upsertOmdbRatings(tx: MovieTx, movieId: string, omdbRatings: OmdbRatingSnapshot | null): Promise<void> {
  if (omdbRatings?.imdbRating != null) {
    await tx.movieExternalRating.upsert({
      where: {
        movieId_source: { movieId, source: ExternalRatingSource.IMDB },
      },
      create: {
        movieId,
        source: ExternalRatingSource.IMDB,
        ratingValue: omdbRatings.imdbRating,
        ratingScale: 10,
        ratingRaw: `${omdbRatings.imdbRating}/10`,
      },
      update: {
        ratingValue: omdbRatings.imdbRating,
        ratingScale: 10,
        ratingRaw: `${omdbRatings.imdbRating}/10`,
      },
    });
  }

  if (omdbRatings?.rottenTomatoesPercent != null) {
    await tx.movieExternalRating.upsert({
      where: {
        movieId_source: { movieId, source: ExternalRatingSource.ROTTEN_TOMATOES },
      },
      create: {
        movieId,
        source: ExternalRatingSource.ROTTEN_TOMATOES,
        ratingValue: omdbRatings.rottenTomatoesPercent,
        ratingScale: 100,
        ratingRaw: `${omdbRatings.rottenTomatoesPercent}%`,
      },
      update: {
        ratingValue: omdbRatings.rottenTomatoesPercent,
        ratingScale: 100,
        ratingRaw: `${omdbRatings.rottenTomatoesPercent}%`,
      },
    });
  }
}

async function findExistingMovie(tx: MovieTx, detail: TmdbMovieQuickImported) {
  const byTmdb = await tx.movie.findUnique({ where: { tmdbId: detail.tmdbId } });
  return byTmdb ?? (detail.imdbId ? await tx.movie.findUnique({ where: { imdbId: detail.imdbId } }) : null);
}

async function upsertMovieCore(
  tx: MovieTx,
  detail: TmdbMovieQuickImported,
): Promise<{ movie: { id: string; imdbId: string | null; tmdbId: number | null; title: string }; created: boolean }> {
  const existing = await findExistingMovie(tx, detail);
  const existedBefore = existing != null;

  let movie: { id: string; imdbId: string | null; tmdbId: number | null; title: string };

  if (existing) {
    movie = await tx.movie.update({
      where: { id: existing.id },
      data: {
        title: detail.title,
        releaseYear: detail.releaseYear,
        runtimeMinutes: detail.runtimeMinutes,
        synopsis: detail.synopsis,
        posterUrl: detail.posterUrl,
        tmdbId: detail.tmdbId,
        ...(detail.imdbId ? { imdbId: detail.imdbId } : {}),
      },
      select: { id: true, imdbId: true, tmdbId: true, title: true },
    });
  } else {
    movie = await tx.movie.create({
      data: {
        title: detail.title,
        releaseYear: detail.releaseYear,
        runtimeMinutes: detail.runtimeMinutes,
        synopsis: detail.synopsis,
        posterUrl: detail.posterUrl,
        imdbId: detail.imdbId,
        tmdbId: detail.tmdbId,
      },
      select: { id: true, imdbId: true, tmdbId: true, title: true },
    });
  }

  await upsertMovieGenres(tx, movie.id, detail.genreNames);
  await upsertTmdbRating(tx, movie.id, detail.tmdbVoteAverage);

  return { movie, created: !existedBefore };
}

async function loadMovieResult(movieId: string): Promise<MovieImportResult["movie"]> {
  return prisma.movie.findUniqueOrThrow({
    where: { id: movieId },
    select: {
      id: true,
      imdbId: true,
      tmdbId: true,
      title: true,
      releaseYear: true,
      runtimeMinutes: true,
      synopsis: true,
      posterUrl: true,
    },
  });
}

/** Fast path: one TMDB call, basic movie row + genres + TMDB score. */
export async function quickImportMovieFromTmdb(tmdbIdInput: number): Promise<MovieImportResult> {
  assertValidTmdbId(tmdbIdInput);
  const detail = await tmdbFetchMovieQuickPayload(tmdbIdInput);

  const { movie, created } = await prisma.$transaction(async (tx) => upsertMovieCore(tx, detail), {
    timeout: QUICK_TX_TIMEOUT_MS,
  });

  return {
    created,
    movie: await loadMovieResult(movie.id),
  };
}

/** Slow path: credits, OMDb ratings, cast/director linking. Safe to run in background. */
export async function enrichMovieFromTmdb(tmdbIdInput: number): Promise<void> {
  assertValidTmdbId(tmdbIdInput);
  const detail = await tmdbFetchMovieImportPayload(tmdbIdInput);

  let omdbRatings: OmdbRatingSnapshot | null = null;
  if (detail.imdbId) {
    try {
      const omdb = await omdbGetByImdbId(detail.imdbId);
      omdbRatings = {
        imdbRating: omdb.imdbRating,
        rottenTomatoesPercent: omdb.rottenTomatoesPercent,
      };
    } catch {
      omdbRatings = null;
    }
  }

  const personIdByName = await resolvePersonIdMap([
    ...detail.directors,
    ...detail.cast.map((m) => m.name),
  ]);

  await prisma.$transaction(
    async (tx) => {
      const { movie } = await upsertMovieCore(tx, detail);

      await tx.movieDirector.deleteMany({ where: { movieId: movie.id } });
      const directorIds = new Set<string>();
      for (const name of detail.directors) {
        const personId = personIdFromMap(personIdByName, name);
        if (personId && !directorIds.has(personId)) {
          directorIds.add(personId);
          await tx.movieDirector.create({
            data: { movieId: movie.id, personId },
          });
        }
      }

      await tx.movieCast.deleteMany({ where: { movieId: movie.id } });
      const castIds = new Set<string>();
      for (const m of detail.cast) {
        const personId = personIdFromMap(personIdByName, m.name);
        if (personId && !castIds.has(personId)) {
          castIds.add(personId);
          await tx.movieCast.create({
            data: {
              movieId: movie.id,
              personId,
              characterName: m.character,
            },
          });
        }
      }

      await upsertOmdbRatings(tx, movie.id, omdbRatings);
    },
    { timeout: ENRICH_TX_TIMEOUT_MS },
  );
}

/** Full synchronous import (scripts, refresh jobs). */
export async function importMovieFromTmdb(tmdbIdInput: number): Promise<MovieImportResult> {
  const quick = await quickImportMovieFromTmdb(tmdbIdInput);
  await enrichMovieFromTmdb(tmdbIdInput);
  return {
    created: quick.created,
    movie: await loadMovieResult(quick.movie.id),
  };
}

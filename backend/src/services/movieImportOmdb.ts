import { ExternalRatingSource, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { omdbGetByImdbId } from "./omdb.js";

function parseReleaseYear(yearStr: string): number {
  const m = yearStr.match(/\d{4}/);
  if (!m) {
    const err = new Error(`Could not parse release year from OMDb: "${yearStr}"`) as Error & { status: number };
    err.status = 422;
    throw err;
  }
  return Number(m[0]);
}

function parseRuntimeMinutes(runtime: string | null): number | null {
  if (!runtime) return null;
  const m = runtime.match(/(\d+)\s*min/i);
  return m ? Number(m[1]) : null;
}

function splitCsv(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function findOrCreatePerson(tx: Prisma.TransactionClient, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = await tx.person.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } },
  });
  if (existing) return existing;
  return tx.person.create({ data: { name: trimmed } });
}

export async function importMovieFromOmdb(imdbIdInput: string): Promise<{
  created: boolean;
  movie: {
    id: string;
    imdbId: string | null;
    title: string;
    releaseYear: number;
    runtimeMinutes: number | null;
    synopsis: string | null;
    posterUrl: string | null;
  };
}> {
  const imdbId = imdbIdInput.trim().toLowerCase();
  if (!/^tt\d+$/i.test(imdbId)) {
    const err = new Error("imdbId must look like tt0111161") as Error & { status: number };
    err.status = 400;
    throw err;
  }

  const detail = await omdbGetByImdbId(imdbId);
  const releaseYear = parseReleaseYear(detail.year);
  const runtimeMinutes = parseRuntimeMinutes(detail.runtime);

  return prisma.$transaction(async (tx) => {
    const existedBefore = await tx.movie.findUnique({ where: { imdbId: detail.imdbId } });

    const movie = await tx.movie.upsert({
      where: { imdbId: detail.imdbId },
      create: {
        imdbId: detail.imdbId,
        title: detail.title,
        releaseYear,
        runtimeMinutes,
        synopsis: detail.plot,
        posterUrl: detail.posterUrl,
      },
      update: {
        title: detail.title,
        releaseYear,
        runtimeMinutes,
        synopsis: detail.plot,
        posterUrl: detail.posterUrl,
      },
    });

    await tx.movieGenre.deleteMany({ where: { movieId: movie.id } });
    for (const genreName of splitCsv(detail.genre)) {
      const genre = await tx.genre.upsert({
        where: { name: genreName },
        create: { name: genreName },
        update: {},
      });
      await tx.movieGenre.create({
        data: { movieId: movie.id, genreId: genre.id },
      });
    }

    await tx.movieDirector.deleteMany({ where: { movieId: movie.id } });
    const directorIds = new Set<string>();
    for (const name of splitCsv(detail.director)) {
      const person = await findOrCreatePerson(tx, name);
      if (person && !directorIds.has(person.id)) {
        directorIds.add(person.id);
        await tx.movieDirector.create({
          data: { movieId: movie.id, personId: person.id },
        });
      }
    }

    await tx.movieCast.deleteMany({ where: { movieId: movie.id } });
    const castIds = new Set<string>();
    for (const name of splitCsv(detail.actors)) {
      const person = await findOrCreatePerson(tx, name);
      if (person && !castIds.has(person.id)) {
        castIds.add(person.id);
        await tx.movieCast.create({
          data: {
            movieId: movie.id,
            personId: person.id,
            characterName: null,
          },
        });
      }
    }

    if (detail.imdbRating != null) {
      await tx.movieExternalRating.upsert({
        where: {
          movieId_source: { movieId: movie.id, source: ExternalRatingSource.IMDB },
        },
        create: {
          movieId: movie.id,
          source: ExternalRatingSource.IMDB,
          ratingValue: detail.imdbRating,
          ratingScale: 10,
          ratingRaw: `${detail.imdbRating}/10`,
        },
        update: {
          ratingValue: detail.imdbRating,
          ratingScale: 10,
          ratingRaw: `${detail.imdbRating}/10`,
        },
      });
    } else {
      await tx.movieExternalRating.deleteMany({
        where: { movieId: movie.id, source: ExternalRatingSource.IMDB },
      });
    }

    if (detail.rottenTomatoesPercent != null) {
      await tx.movieExternalRating.upsert({
        where: {
          movieId_source: { movieId: movie.id, source: ExternalRatingSource.ROTTEN_TOMATOES },
        },
        create: {
          movieId: movie.id,
          source: ExternalRatingSource.ROTTEN_TOMATOES,
          ratingValue: detail.rottenTomatoesPercent,
          ratingScale: 100,
          ratingRaw: `${detail.rottenTomatoesPercent}%`,
        },
        update: {
          ratingValue: detail.rottenTomatoesPercent,
          ratingScale: 100,
          ratingRaw: `${detail.rottenTomatoesPercent}%`,
        },
      });
    } else {
      await tx.movieExternalRating.deleteMany({
        where: { movieId: movie.id, source: ExternalRatingSource.ROTTEN_TOMATOES },
      });
    }

    return {
      created: !existedBefore,
      movie: {
        id: movie.id,
        imdbId: movie.imdbId,
        title: movie.title,
        releaseYear: movie.releaseYear,
        runtimeMinutes: movie.runtimeMinutes,
        synopsis: movie.synopsis,
        posterUrl: movie.posterUrl,
      },
    };
  });
}

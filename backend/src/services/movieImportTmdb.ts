import { ExternalRatingSource, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { tmdbFetchMovieImportPayload } from "./tmdb.js";

async function findOrCreatePerson(tx: Prisma.TransactionClient, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = await tx.person.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } },
  });
  if (existing) return existing;
  return tx.person.create({ data: { name: trimmed } });
}

export async function importMovieFromTmdb(tmdbIdInput: number): Promise<{
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
}> {
  if (!Number.isInteger(tmdbIdInput) || tmdbIdInput < 1) {
    const err = new Error("tmdbId must be a positive integer") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const detail = await tmdbFetchMovieImportPayload(tmdbIdInput);

  return prisma.$transaction(async (tx) => {
    const byTmdb = await tx.movie.findUnique({ where: { tmdbId: detail.tmdbId } });
    let existing =
      byTmdb ?? (detail.imdbId ? await tx.movie.findUnique({ where: { imdbId: detail.imdbId } }) : null);
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

    await tx.movieGenre.deleteMany({ where: { movieId: movie.id } });
    for (const genreName of detail.genreNames) {
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
    for (const name of detail.directors) {
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
    for (const m of detail.cast) {
      const person = await findOrCreatePerson(tx, m.name);
      if (person && !castIds.has(person.id)) {
        castIds.add(person.id);
        await tx.movieCast.create({
          data: {
            movieId: movie.id,
            personId: person.id,
            characterName: m.character,
          },
        });
      }
    }

    if (detail.tmdbVoteAverage != null) {
      const val = Number(detail.tmdbVoteAverage.toFixed(1));
      await tx.movieExternalRating.upsert({
        where: {
          movieId_source: { movieId: movie.id, source: ExternalRatingSource.TMDB },
        },
        create: {
          movieId: movie.id,
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
        where: { movieId: movie.id, source: ExternalRatingSource.TMDB },
      });
    }

    const full = await tx.movie.findUniqueOrThrow({
      where: { id: movie.id },
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

    return {
      created: !existedBefore,
      movie: full,
    };
  });
}

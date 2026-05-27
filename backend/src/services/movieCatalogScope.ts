import type { Prisma } from "@prisma/client";
import { AuditActionType, type UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/** Movie ids tied to this user via imports (audit trail), shelf, or ratings. */
export async function collectAccessibleMovieIds(userId: string): Promise<string[]> {
  const [importRows, shelfRows, ratingRows, hiddenRows] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        userId,
        resourceId: { not: null },
        actionType: { in: [AuditActionType.MOVIE_IMPORT_TMDB, AuditActionType.MOVIE_IMPORT_OMDB] },
      },
      select: { resourceId: true },
    }),
    prisma.collectionMovie.findMany({
      where: { collection: { userId } },
      select: { movieId: true },
    }),
    prisma.userMovieRating.findMany({
      where: { userId },
      select: { movieId: true },
    }),
    prisma.userHiddenMovie.findMany({
      where: { userId },
      select: { movieId: true },
    }),
  ]);

  const hidden = new Set(hiddenRows.map((h) => h.movieId));

  const ids = new Set<string>();
  for (const r of importRows) {
    if (r.resourceId) ids.add(r.resourceId);
  }
  for (const r of shelfRows) ids.add(r.movieId);
  for (const r of ratingRows) ids.add(r.movieId);
  return [...ids].filter((id) => !hidden.has(id));
}

/** TMDB ids for movies this user can see in their catalog (imports, shelf, ratings; minus hidden). */
export async function collectAccessibleTmdbIds(userId: string): Promise<number[]> {
  const movieIds = await collectAccessibleMovieIds(userId);
  if (movieIds.length === 0) return [];

  const rows = await prisma.movie.findMany({
    where: { id: { in: movieIds }, tmdbId: { not: null } },
    select: { tmdbId: true },
  });

  return [
    ...new Set(
      rows
        .map((r) => r.tmdbId)
        .filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0),
    ),
  ];
}

/** Extra Prisma WHERE for movie rows non-admin callers may see (`null` = no restriction / admin). */
export async function movieVisibilityWhere(role: UserRole, userId: string): Promise<Prisma.MovieWhereInput | null> {
  const hiddenMovies = await prisma.userHiddenMovie.findMany({
    where: { userId },
    select: { movieId: true },
  });
  const hiddenIds = hiddenMovies.map((h) => h.movieId);

  if (role === "ADMIN") {
    if (hiddenIds.length === 0) return null;
    return { id: { notIn: hiddenIds } };
  }

  const ids = await collectAccessibleMovieIds(userId);
  return ids.length > 0 ? { id: { in: ids } } : { id: { in: ["00000000-0000-0000-0000-000000000000"] as string[] } };
}

export async function userCanAccessMovie(role: UserRole, userId: string, movieId: string): Promise<boolean> {
  const hidden = await prisma.userHiddenMovie.findUnique({
    where: { userId_movieId: { userId, movieId } },
    select: { movieId: true },
  });
  if (hidden) return false;

  if (role === "ADMIN") return true;
  const ids = await collectAccessibleMovieIds(userId);
  return ids.includes(movieId);
}

import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { movieVisibilityWhere, userCanAccessMovie } from "../services/movieCatalogScope.js";
import { writeAuditLog } from "../services/auditLog.js";
import { importMovieFromOmdb } from "../services/movieImportOmdb.js";
import { importMovieFromTmdb } from "../services/movieImportTmdb.js";
import { omdbGetByImdbId, omdbSearch } from "../services/omdb.js";
import { tmdbFetchMovieImportPayload, tmdbSearchForUiPage, tmdbTrendingForUiPage } from "../services/tmdb.js";

export const moviesRouter = Router();

/** OMDb-backed search (IMDb ids & metadata). Requires OMDB_API_KEY. */
moviesRouter.get("/external/search", async (req: Request, res, next) => {
  try {
    const querySchema = z.object({
      q: z.string().min(1, "query required"),
      page: z.coerce.number().min(1).optional().default(1),
    });
    const q = querySchema.parse(req.query);

    const header = req.headers.authorization;
    let userId: string | undefined;
    if (header?.startsWith("Bearer ")) {
      try {
        const { verifyAccessToken } = await import("../lib/jwt.js");
        const payload = verifyAccessToken(header.slice("Bearer ".length));
        userId = payload.sub;
      } catch {
        userId = undefined;
      }
    }

    const result = await omdbSearch({ query: q.q, page: q.page });

    if (userId) {
      await writeAuditLog({
        userId,
        actionType: "SEARCH_STRUCTURED",
        resourceType: "movie_external",
        resourceLabel: q.q,
        metadata: { provider: "omdb", page: q.page, total: result.total },
      });
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
});

/** TMDB trending (default shelf when discover query is empty). Supports UI page/limit (~28). */
moviesRouter.get("/external/tmdb/trending", async (req: Request, res, next) => {
  try {
    const querySchema = z.object({
      window: z.enum(["day", "week"]).optional().default("week"),
      page: z.coerce.number().int().min(1).optional().default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional().default(28),
    });
    const q = querySchema.parse(req.query);

    const result = await tmdbTrendingForUiPage(q.window, q.page, q.pageSize);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

moviesRouter.get("/external/tmdb/search", async (req: Request, res, next) => {
  try {
    const querySchema = z.object({
      q: z.string().min(1, "query required"),
      page: z.coerce.number().min(1).optional().default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional().default(28),
    });
    const q = querySchema.parse(req.query);

    const header = req.headers.authorization;
    let userId: string | undefined;
    if (header?.startsWith("Bearer ")) {
      try {
        const { verifyAccessToken } = await import("../lib/jwt.js");
        const payload = verifyAccessToken(header.slice("Bearer ".length));
        userId = payload.sub;
      } catch {
        userId = undefined;
      }
    }

    const result = await tmdbSearchForUiPage(q.q, q.page, q.pageSize);

    if (userId) {
      await writeAuditLog({
        userId,
        actionType: "SEARCH_STRUCTURED",
        resourceType: "movie_external",
        resourceLabel: q.q,
        metadata: { provider: "tmdb", page: q.page, pageSize: q.pageSize, total: result.total },
      });
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
});

moviesRouter.get("/external/tmdb/movie/:tmdbId", async (req, res, next) => {
  try {
    const tmdbId = z.coerce.number().int().positive().parse(req.params.tmdbId);
    const payload = await tmdbFetchMovieImportPayload(tmdbId);
    res.json({
      tmdbId: payload.tmdbId,
      imdbId: payload.imdbId,
      title: payload.title,
      releaseYear: payload.releaseYear,
      runtimeMinutes: payload.runtimeMinutes,
      synopsis: payload.synopsis,
      posterUrl: payload.posterUrl,
      genres: payload.genreNames,
      directors: payload.directors,
      cast: payload.cast,
      voteAverage: payload.tmdbVoteAverage,
    });
  } catch (e) {
    next(e);
  }
});

moviesRouter.get("/external/omdb/:imdbId", async (req, res, next) => {
  try {
    const imdbId = z
      .string()
      .regex(/^tt\d+$/i, "expected imdb id like tt0111161")
      .parse(req.params.imdbId)
      .toLowerCase();

    const movie = await omdbGetByImdbId(imdbId);
    res.json(movie);
  } catch (e) {
    next(e);
  }
});

/** Create or refresh a catalog `Movie` from OMDb (genres, cast, directors, IMDb & RT scores). */
moviesRouter.post("/import/omdb", requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      imdbId: z
        .string()
        .trim()
        .min(3)
        .regex(/^tt\d+$/i, "imdbId must look like tt0111161"),
    });
    const body = schema.parse(req.body);
    const userId = req.user!.id;

    const result = await importMovieFromOmdb(body.imdbId);

    await writeAuditLog({
      userId,
      actionType: "MOVIE_IMPORT_OMDB",
      resourceType: "movie",
      resourceId: result.movie.id,
      resourceLabel: result.movie.title,
      metadata: {
        imdbId: result.movie.imdbId,
        created: result.created,
      },
    });

    await prisma.userHiddenMovie.deleteMany({
      where: { userId, movieId: result.movie.id },
    });

    res.status(result.created ? 201 : 200).json(result);
  } catch (e) {
    next(e);
  }
});

moviesRouter.post("/import/tmdb", requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      tmdbId: z.coerce.number().int().positive(),
    });
    const body = schema.parse(req.body);
    const userId = req.user!.id;

    const result = await importMovieFromTmdb(body.tmdbId);

    await writeAuditLog({
      userId,
      actionType: "MOVIE_IMPORT_TMDB",
      resourceType: "movie",
      resourceId: result.movie.id,
      resourceLabel: result.movie.title,
      metadata: {
        tmdbId: result.movie.tmdbId,
        imdbId: result.movie.imdbId,
        created: result.created,
      },
    });

    await prisma.userHiddenMovie.deleteMany({
      where: { userId, movieId: result.movie.id },
    });

    res.status(result.created ? 201 : 200).json(result);
  } catch (e) {
    next(e);
  }
});

moviesRouter.get("/", requireAuth, async (req: Request, res, next) => {
  try {
    const querySchema = z.object({
      page: z.coerce.number().min(1).optional().default(1),
      pageSize: z.coerce.number().min(1).max(50).optional().default(20),
      cast: z.string().optional(),
      director: z.string().optional(),
      genre: z.string().optional(),
      q: z.string().optional(),
    });
    const q = querySchema.parse(req.query);
    const viewer = req.user!;

    const visibility = await movieVisibilityWhere(viewer.role, viewer.id);

    const filters: Prisma.MovieWhereInput[] = [];
    if (q.q) filters.push({ title: { contains: q.q, mode: "insensitive" as const } });
    if (q.genre) {
      filters.push({
        genres: {
          some: {
            genre: { name: { equals: q.genre, mode: "insensitive" as const } },
          },
        },
      });
    }
    if (q.cast) {
      filters.push({
        cast: {
          some: {
            person: { name: { contains: q.cast, mode: "insensitive" as const } },
          },
        },
      });
    }
    if (q.director) {
      filters.push({
        directors: {
          some: {
            director: {
              name: { contains: q.director, mode: "insensitive" as const },
            },
          },
        },
      });
    }

    let where: Prisma.MovieWhereInput;
    if (filters.length === 0) {
      where = visibility ?? {};
    } else if (visibility) {
      where = { AND: [...filters, visibility] };
    } else {
      where = { AND: filters };
    }

    const skip = (q.page - 1) * q.pageSize;
    const [total, rows] = await Promise.all([
      prisma.movie.count({ where }),
      prisma.movie.findMany({
        where,
        skip,
        take: q.pageSize,
        orderBy: [{ title: "asc" }],
        include: {
          genres: { include: { genre: true } },
          externalRatings: true,
          directors: { include: { director: true } },
        },
      }),
    ]);

    if (q.cast || q.director || q.genre || q.q) {
      await writeAuditLog({
        userId: viewer.id,
        actionType: "SEARCH_STRUCTURED",
        resourceType: "movie",
        resourceLabel: [q.q, q.cast, q.director, q.genre].filter(Boolean).join(" | ") || "list",
        metadata: { filters: { ...q } },
      });
    }

    const pages = Math.max(1, Math.ceil(total / q.pageSize));

    res.json({
      page: q.page,
      pageSize: q.pageSize,
      pages,
      total,
      items: rows.map((m) => ({
        id: m.id,
        imdbId: m.imdbId,
        tmdbId: m.tmdbId,
        title: m.title,
        releaseYear: m.releaseYear,
        runtimeMinutes: m.runtimeMinutes,
        posterUrl: m.posterUrl,
        genres: m.genres.map((g) => g.genre.name),
        directors: m.directors.map((d) => d.director.name),
        externalRatings: m.externalRatings.map((er) => ({
          source: er.source,
          value: er.ratingValue,
          scale: er.ratingScale,
          raw: er.ratingRaw,
        })),
      })),
    });
  } catch (e) {
    next(e);
  }
});

moviesRouter.get("/:movieId", requireAuth, async (req: Request, res, next) => {
  try {
    const movieId = z.string().uuid().parse(req.params.movieId);
    const viewer = req.user!;

    const movie = await prisma.movie.findUnique({
      where: { id: movieId },
      include: {
        genres: { include: { genre: true } },
        cast: { include: { person: true } },
        directors: { include: { director: true } },
        externalRatings: true,
      },
    });
    if (!movie) {
      res.status(404).json({ error: "Movie not found" });
      return;
    }

    const allowed = await userCanAccessMovie(viewer.role, viewer.id, movieId);
    if (!allowed) {
      res.status(404).json({ error: "Movie not found" });
      return;
    }

    const r = await prisma.userMovieRating.findUnique({
      where: { userId_movieId: { userId: viewer.id, movieId } },
    });
    const userRating = r?.rating ?? null;

    res.json({
      id: movie.id,
      imdbId: movie.imdbId,
      tmdbId: movie.tmdbId,
      title: movie.title,
      releaseYear: movie.releaseYear,
      runtimeMinutes: movie.runtimeMinutes,
      synopsis: movie.synopsis,
      posterUrl: movie.posterUrl,
      genres: movie.genres.map((g) => g.genre.name),
      cast: movie.cast.map((c) => ({
        name: c.person.name,
        character: c.characterName,
      })),
      directors: movie.directors.map((d) => d.director.name),
      externalRatings: movie.externalRatings.map((er) => ({
        source: er.source,
        value: er.ratingValue,
        scale: er.ratingScale,
        raw: er.ratingRaw,
      })),
      userRating,
    });
  } catch (e) {
    next(e);
  }
});

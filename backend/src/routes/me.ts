import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { writeAuditLog } from "../services/auditLog.js";
import { userCanAccessMovie, collectAccessibleTmdbIds } from "../services/movieCatalogScope.js";

export const collectionsRouter = Router();

collectionsRouter.get("/:slug", async (req, res, next) => {
  try {
    const slug = z.string().min(1).parse(req.params.slug);
    const coll = await prisma.userCollection.findUnique({
      where: { slug },
      include: {
        user: { select: { displayName: true } },
        movies: {
          include: {
            movie: {
              include: {
                genres: { include: { genre: true } },
                externalRatings: true,
              },
            },
          },
        },
      },
    });
    if (!coll || !coll.isPublic) {
      res.status(404).json({ error: "Collection not found or private" });
      return;
    }
    res.json({
      slug: coll.slug,
      title: coll.title,
      ownerDisplayName: coll.user.displayName,
      movies: coll.movies.map((cm) => ({
        addedAt: cm.addedAt,
        notes: cm.notes,
        movie: {
          id: cm.movie.id,
          imdbId: cm.movie.imdbId,
          tmdbId: cm.movie.tmdbId,
          title: cm.movie.title,
          releaseYear: cm.movie.releaseYear,
          runtimeMinutes: cm.movie.runtimeMinutes,
          posterUrl: cm.movie.posterUrl,
          genres: cm.movie.genres.map((g) => g.genre.name),
          externalRatings: cm.movie.externalRatings.map((er) => ({
            source: er.source,
            value: er.ratingValue,
            scale: er.ratingScale,
            raw: er.ratingRaw,
          })),
        },
      })),
    });
  } catch (e) {
    next(e);
  }
});

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get("/collection", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    let coll = await prisma.userCollection.findFirst({
      where: { userId },
      include: {
        movies: {
          include: {
            movie: {
              include: {
                genres: { include: { genre: true } },
                externalRatings: true,
              },
            },
          },
          orderBy: { addedAt: "desc" },
        },
      },
    });

    if (!coll) {
      coll = await prisma.userCollection.create({
        data: {
          userId,
          slug: `u-${userId.slice(0, 8)}`,
          title: "My Collection",
          isPublic: false,
        },
        include: {
          movies: {
            include: {
              movie: {
                include: {
                  genres: { include: { genre: true } },
                  externalRatings: true,
                },
              },
            },
          },
        },
      });
    }

    res.json({
      id: coll.id,
      slug: coll.slug,
      title: coll.title,
      isPublic: coll.isPublic,
      movies: coll.movies.map((cm) => ({
        addedAt: cm.addedAt,
        notes: cm.notes,
        movie: {
          id: cm.movie.id,
          imdbId: cm.movie.imdbId,
          tmdbId: cm.movie.tmdbId,
          title: cm.movie.title,
          releaseYear: cm.movie.releaseYear,
          runtimeMinutes: cm.movie.runtimeMinutes,
          posterUrl: cm.movie.posterUrl,
          genres: cm.movie.genres.map((g) => g.genre.name),
          externalRatings: cm.movie.externalRatings.map((er) => ({
            source: er.source,
            value: er.ratingValue,
            scale: er.ratingScale,
            raw: er.ratingRaw,
          })),
        },
      })),
    });
  } catch (e) {
    next(e);
  }
});

meRouter.post("/collection/movies", async (req, res, next) => {
  try {
    const schema = z.object({
      movieId: z.string().uuid(),
      notes: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const userId = req.user!.id;

    let coll = await prisma.userCollection.findFirst({ where: { userId } });
    if (!coll) {
      coll = await prisma.userCollection.create({
        data: {
          userId,
          slug: `u-${userId.slice(0, 8)}`,
          title: "My Collection",
          isPublic: false,
        },
      });
    }

    try {
      await prisma.collectionMovie.create({
        data: {
          collectionId: coll.id,
          movieId: body.movieId,
          notes: body.notes,
        },
      });
    } catch {
      res.status(409).json({ error: "Movie already in collection" });
      return;
    }

    await writeAuditLog({
      userId,
      actionType: "COLLECTION_ADD_MOVIE",
      resourceType: "movie",
      resourceId: body.movieId,
      metadata: {},
    });

    res.status(201).json({ ok: true });
  } catch (e) {
    next(e);
  }
});

meRouter.delete("/collection/movies/:movieId", async (req, res, next) => {
  try {
    const movieId = z.string().uuid().parse(req.params.movieId);
    const userId = req.user!.id;
    const coll = await prisma.userCollection.findFirst({ where: { userId } });
    if (!coll) {
      res.status(404).json({ error: "No collection" });
      return;
    }
    await prisma.collectionMovie.deleteMany({
      where: { collectionId: coll.id, movieId },
    });

    await writeAuditLog({
      userId,
      actionType: "COLLECTION_REMOVE_MOVIE",
      resourceType: "movie",
      resourceId: movieId,
      metadata: {},
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

meRouter.patch("/collection", async (req, res, next) => {
  try {
    const schema = z.object({
      title: z.string().min(1).optional(),
      isPublic: z.boolean().optional(),
    });
    const body = schema.parse(req.body);
    const userId = req.user!.id;

    let coll = await prisma.userCollection.findFirst({ where: { userId } });
    if (!coll) {
      coll = await prisma.userCollection.create({
        data: {
          userId,
          slug: `u-${userId.slice(0, 8)}`,
          title: body.title ?? "My Collection",
          isPublic: body.isPublic ?? false,
        },
      });
    } else {
      coll = await prisma.userCollection.update({
        where: { id: coll.id },
        data: {
          title: body.title ?? undefined,
          isPublic: body.isPublic ?? undefined,
        },
      });
    }

    res.json({
      id: coll.id,
      slug: coll.slug,
      title: coll.title,
      isPublic: coll.isPublic,
    });
  } catch (e) {
    next(e);
  }
});

meRouter.get("/catalog/tmdb-ids", async (req, res, next) => {
  try {
    const tmdbIds = await collectAccessibleTmdbIds(req.user!.id);
    res.json({ tmdbIds });
  } catch (e) {
    next(e);
  }
});

meRouter.delete("/catalog/movies/:movieId", async (req, res, next) => {
  try {
    const movieId = z.string().uuid().parse(req.params.movieId);
    const userId = req.user!.id;

    const allowed = await userCanAccessMovie(req.user!.role, userId, movieId);
    if (!allowed) {
      res.status(404).json({ error: "Movie not found" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.userHiddenMovie.upsert({
        where: { userId_movieId: { userId, movieId } },
        create: { userId, movieId },
        update: {},
      });
      await tx.collectionMovie.deleteMany({
        where: { movieId, collection: { userId } },
      });
      await tx.userMovieRating.deleteMany({ where: { userId, movieId } });
    });

    await writeAuditLog({
      userId,
      actionType: "CATALOG_REMOVE_MOVIE",
      resourceType: "movie",
      resourceId: movieId,
      metadata: {},
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

meRouter.post("/ratings", async (req, res, next) => {
  try {
    const schema = z.object({
      movieId: z.string().uuid(),
      rating: z.number().int().min(1).max(10),
    });
    const body = schema.parse(req.body);
    const userId = req.user!.id;

    try {
      await prisma.userMovieRating.create({
        data: {
          userId,
          movieId: body.movieId,
          rating: body.rating,
        },
      });
    } catch {
      res.status(409).json({ error: "You already rated this movie" });
      return;
    }

    await writeAuditLog({
      userId,
      actionType: "RATING_SUBMIT",
      resourceType: "movie",
      resourceId: body.movieId,
      metadata: { rating: body.rating },
    });

    res.status(201).json({ ok: true });
  } catch (e) {
    next(e);
  }
});

meRouter.get("/audit-logs", async (req, res, next) => {
  try {
    const schema = z.object({
      page: z.coerce.number().min(1).optional().default(1),
      pageSize: z.coerce.number().min(1).max(100).optional().default(30),
    });
    const q = schema.parse(req.query);
    const userId = req.user!.id;
    const skip = (q.page - 1) * q.pageSize;

    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where: { userId } }),
      prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAtUtc: "desc" },
        skip,
        take: q.pageSize,
      }),
    ]);

    res.json({
      page: q.page,
      pageSize: q.pageSize,
      total,
      items: rows.map((r) => ({
        id: r.id,
        actionType: r.actionType,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        resourceLabel: r.resourceLabel,
        metadata: r.metadata,
        createdAtUtc: r.createdAtUtc,
      })),
    });
  } catch (e) {
    next(e);
  }
});

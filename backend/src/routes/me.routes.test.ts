import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { signAccessToken } from "../lib/jwt.js";

const collFindFirst = vi.hoisted(() => vi.fn());
const collCreate = vi.hoisted(() => vi.fn());
const collUpdate = vi.hoisted(() => vi.fn());
const collMovieCreate = vi.hoisted(() => vi.fn());
const collMovieDeleteMany = vi.hoisted(() => vi.fn());
const prismaTransaction = vi.hoisted(() => vi.fn());
const ratingCreate = vi.hoisted(() => vi.fn());
const ratingDeleteMany = vi.hoisted(() => vi.fn());
const auditCount = vi.hoisted(() => vi.fn());
const auditMany = vi.hoisted(() => vi.fn());
const upsertHidden = vi.hoisted(() => vi.fn());
const userFindUnique = vi.hoisted(() => vi.fn());

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: userFindUnique,
    },
    userCollection: {
      findFirst: collFindFirst,
      create: collCreate,
      update: collUpdate,
    },
    collectionMovie: {
      create: collMovieCreate,
      deleteMany: collMovieDeleteMany,
    },
    userMovieRating: {
      deleteMany: ratingDeleteMany,
      create: ratingCreate,
    },
    userHiddenMovie: {
      upsert: upsertHidden,
    },
    auditLog: {
      count: auditCount,
      findMany: auditMany,
    },
    $transaction: prismaTransaction,
  },
}));

const userAccess = vi.hoisted(() => vi.fn());

vi.mock("../services/movieCatalogScope.js", () => ({
  userCanAccessMovie: (...args: unknown[]) => userAccess(...args),
  movieVisibilityWhere: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/auditLog.js", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { writeAuditLog } from "../services/auditLog.js";

describe("/api/me", () => {
  let app: Express;
  const userId = randomUUID();
  const movieId = randomUUID();
  const collId = randomUUID();

  beforeEach(() => {
    app = createApp();
    userFindUnique.mockReset().mockResolvedValue({
      id: userId,
      email: "me@test.dev",
      role: "USER",
    });
    collFindFirst.mockReset();
    collCreate.mockReset().mockResolvedValue({
      id: collId,
      slug: `u-${userId.slice(0, 8)}`,
      title: "My Collection",
      isPublic: false,
      movies: [],
    });
    collUpdate.mockResolvedValue({
      id: collId,
      slug: `u-${userId.slice(0, 8)}`,
      title: "Renamed",
      isPublic: true,
    });
    collMovieCreate.mockReset().mockResolvedValue({});
    collMovieDeleteMany.mockReset().mockResolvedValue({ count: 1 });
    ratingCreate.mockReset().mockResolvedValue({});
    ratingDeleteMany.mockReset().mockResolvedValue({ count: 1 });
    prismaTransaction.mockImplementation(
      async (
        fn: (tx: {
          userHiddenMovie: { upsert: typeof upsertHidden };
          collectionMovie: { deleteMany: typeof collMovieDeleteMany };
          userMovieRating: { deleteMany: typeof ratingDeleteMany };
        }) => Promise<unknown>,
      ) => {
        const tx = {
          userHiddenMovie: { upsert: upsertHidden },
          collectionMovie: { deleteMany: collMovieDeleteMany },
          userMovieRating: { deleteMany: ratingDeleteMany },
        };
        await fn(tx);
      },
    );
    auditCount.mockReset().mockResolvedValue(1);
    auditMany.mockReset().mockResolvedValue([
      {
        id: "log-1",
        actionType: "AUTH_LOGIN",
        resourceType: "auth",
        resourceId: null,
        resourceLabel: null,
        metadata: {},
        createdAtUtc: new Date("2026-05-01T00:00:00.000Z"),
      },
    ]);
    upsertHidden.mockReset().mockResolvedValue({});
    userAccess.mockReset().mockResolvedValue(true);
    vi.mocked(writeAuditLog).mockClear();
  });

  const headers = () => ({
    Authorization: `Bearer ${signAccessToken({
      sub: userId,
      email: "me@test.dev",
      role: "USER",
    })}`,
  });

  /** Matches Prisma-shaped shelf rows incl. genres + externalRatings mappers on GET /collection. */
  const shelfRowWithHydration = () => ({
    addedAt: new Date("2026-03-01T12:00:00.000Z"),
    notes: "Great pick" as string | null,
    movie: {
      id: movieId,
      imdbId: "tt123",
      tmdbId: 42,
      title: "Neo Noir",
      releaseYear: 1999,
      runtimeMinutes: 120,
      posterUrl: "/neo.jpg",
      genres: [{ genre: { name: "Thriller" } }, { genre: { name: "Sci-Fi" } }],
      externalRatings: [{ source: "IMDB", ratingValue: 8.2, ratingScale: 10, ratingRaw: "8.2" }],
    },
  });

  it("creates a collection when patrons open /collection for the first time", async () => {
    collFindFirst.mockResolvedValueOnce(null);
    const res = await request(app).get("/api/me/collection").set(headers());
    expect(res.status).toBe(200);
    expect(collCreate).toHaveBeenCalled();
  });

  it("returns hydrated genres and rating facets when reloading an existing shelf", async () => {
    collFindFirst.mockResolvedValueOnce({
      id: collId,
      slug: `u-${userId.slice(0, 8)}`,
      title: "My Collection",
      isPublic: false,
      movies: [shelfRowWithHydration()],
    });
    const res = await request(app).get("/api/me/collection").set(headers());
    expect(res.status).toBe(200);
    expect(res.body.movies[0]?.movie.genres).toEqual(["Thriller", "Sci-Fi"]);
    expect(res.body.movies[0]?.movie.externalRatings[0]).toEqual({
      source: "IMDB",
      value: 8.2,
      scale: 10,
      raw: "8.2",
    });
  });

  it("indexes shelf movies onto a patron collection", async () => {
    collFindFirst.mockResolvedValueOnce({
      id: collId,
      slug: `u-${userId.slice(0, 8)}`,
      title: "My Collection",
      isPublic: false,
      movies: [],
    });
    const res = await request(app)
      .post("/api/me/collection/movies")
      .set(headers())
      .send({ movieId });
    expect(res.status).toBe(201);
  });

  it("bootstraps a shelf before inserting movies when patrons have no shelf yet", async () => {
    collFindFirst.mockResolvedValueOnce(null);
    const res = await request(app)
      .post("/api/me/collection/movies")
      .set(headers())
      .send({ movieId, notes: "Watch soon" });
    expect(res.status).toBe(201);
    expect(collCreate).toHaveBeenCalled();
    expect(collMovieCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ collectionId: collId, movieId, notes: "Watch soon" }),
      }),
    );
  });

  it("surfaces uniqueness conflicts via HTTP 409", async () => {
    collMovieCreate.mockRejectedValueOnce(new Error("dup"));
    collFindFirst.mockResolvedValueOnce({
      id: collId,
      slug: `u-${userId.slice(0, 8)}`,
      title: "My Collection",
      isPublic: false,
      movies: [],
    });
    await request(app).post("/api/me/collection/movies").set(headers()).send({ movieId }).expect(409);
  });

  it("drops shelf rows when requested", async () => {
    collFindFirst.mockResolvedValueOnce({
      id: collId,
      slug: `u-${userId.slice(0, 8)}`,
      title: "My Collection",
      isPublic: false,
      movies: [],
    });
    await request(app).delete(`/api/me/collection/movies/${movieId}`).set(headers()).expect(200);
  });

  it("404s when shelving against a missing collection", async () => {
    collFindFirst.mockResolvedValueOnce(null);
    await request(app).delete(`/api/me/collection/movies/${movieId}`).set(headers()).expect(404);
  });

  it("toggles publicity flags through PATCH payloads", async () => {
    collFindFirst.mockResolvedValueOnce({
      id: collId,
      slug: `u-${userId.slice(0, 8)}`,
      title: "My Collection",
      isPublic: false,
      movies: [],
    });
    const res = await request(app).patch("/api/me/collection").set(headers()).send({ isPublic: true });
    expect(res.status).toBe(200);
    expect(collUpdate).toHaveBeenCalled();
    expect(res.body.isPublic).toBe(true);
  });

  it("supports partial collection metadata PATCHes", async () => {
    collFindFirst.mockResolvedValueOnce({
      id: collId,
      slug: `u-${userId.slice(0, 8)}`,
      title: "My Collection",
      isPublic: false,
      movies: [],
    });
    await request(app)
      .patch("/api/me/collection")
      .set(headers())
      .send({ title: "Renamed" })
      .expect(200)
      .expect((res) => {
        expect(res.body.title).toBe("Renamed");
      });
  });

  it("creates the shelf when PATCH metadata runs before a collection exists", async () => {
    collFindFirst.mockResolvedValueOnce(null);
    const res = await request(app).patch("/api/me/collection").set(headers()).send({ title: "Bootstrapped" });
    expect(res.status).toBe(200);
    expect(collCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Bootstrapped",
          isPublic: false,
        }),
      }),
    );
  });

  it("hides inaccessible titles from catalog teardown paths", async () => {
    userAccess.mockResolvedValueOnce(false);
    await request(app).delete(`/api/me/catalog/movies/${movieId}`).set(headers()).expect(404);
  });

  it("transactions hide catalog titles, prune shelves, wipe ratings, and audit teardowns", async () => {
    const res = await request(app).delete(`/api/me/catalog/movies/${movieId}`).set(headers());
    expect(res.status).toBe(200);
    expect(prismaTransaction).toHaveBeenCalled();
    expect(upsertHidden).toHaveBeenCalled();
    expect(ratingDeleteMany).toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CATALOG_REMOVE_MOVIE",
        resourceType: "movie",
        resourceId: movieId,
      }),
    );
  });

  it("scores movies with transactional integrity", async () => {
    const res = await request(app).post("/api/me/ratings").set(headers()).send({
      movieId,
      rating: 8,
    });
    expect(res.status).toBe(201);
  });

  it("responds 400 when rating bodies fall outside concierge bounds", async () => {
    const res = await request(app).post("/api/me/ratings").set(headers()).send({
      movieId,
      rating: 11,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("rejects duplicated ratings politely", async () => {
    ratingCreate.mockRejectedValueOnce(new Error("constraint"));
    const res = await request(app).post("/api/me/ratings").set(headers()).send({
      movieId,
      rating: 6,
    });
    expect(res.status).toBe(409);
  });

  it("returns paginated personal audit timelines", async () => {
    const res = await request(app).get("/api/me/audit-logs?page=1&pageSize=10").set(headers());
    expect(res.status).toBe(200);
    expect(res.body.items[0]?.actionType).toBeTruthy();
    expect(Date.parse(res.body.items[0]?.createdAtUtc)).toBeTruthy();
  });

  it("validates pagination windows for patron audit timelines", async () => {
    const res = await request(app).get("/api/me/audit-logs?page=0").set(headers());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("responds 400 when shelving URLs include malformed IDs", async () => {
    const res = await request(app).delete("/api/me/collection/movies/not-a-real-uuid").set(headers());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("delegates audit log storage failures downstream", async () => {
    auditCount.mockRejectedValueOnce(new Error("count timeout"));
    const res = await request(app).get("/api/me/audit-logs").set(headers());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });

  it("delegates PATCH metadata failures downstream", async () => {
    collFindFirst.mockResolvedValueOnce({
      id: collId,
      slug: `u-${userId.slice(0, 8)}`,
      title: "My Collection",
      isPublic: false,
      movies: [],
    });
    collUpdate.mockRejectedValueOnce(new Error("lost connection"));
    const res = await request(app).patch("/api/me/collection").set(headers()).send({ title: "oops" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});

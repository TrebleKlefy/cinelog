import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { signAccessToken } from "../lib/jwt.js";
import type { Express } from "express";

const movieCount = vi.hoisted(() => vi.fn());
const movieFindMany = vi.hoisted(() => vi.fn());
const movieFindUnique = vi.hoisted(() => vi.fn());
const userRatingFindUnique = vi.hoisted(() => vi.fn());
const hiddenDeleteMany = vi.hoisted(() => vi.fn());

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    movie: {
      count: movieCount,
      findMany: movieFindMany,
      findUnique: movieFindUnique,
    },
    userMovieRating: {
      findUnique: userRatingFindUnique,
    },
    userHiddenMovie: {
      deleteMany: hiddenDeleteMany,
    },
  },
}));

const catalogWhere = vi.hoisted(() => vi.fn());
const catalogAccess = vi.hoisted(() => vi.fn());
vi.mock("../services/movieCatalogScope.js", () => ({
  movieVisibilityWhere: (...args: unknown[]) => catalogWhere(...args),
  userCanAccessMovie: (...args: unknown[]) => catalogAccess(...args),
}));

vi.mock("../services/movieImportOmdb.js", () => ({
  importMovieFromOmdb: vi.fn(),
}));

vi.mock("../services/movieImportTmdb.js", () => ({
  importMovieFromTmdb: vi.fn(),
}));

const omdbSearch = vi.hoisted(() => vi.fn());
const omdbDetail = vi.hoisted(() => vi.fn());
vi.mock("../services/omdb.js", () => ({
  omdbSearch,
  omdbGetByImdbId: omdbDetail,
}));

const trendingUi = vi.hoisted(() => vi.fn());
const searchUi = vi.hoisted(() => vi.fn());
const moviePayload = vi.hoisted(() => vi.fn());
vi.mock("../services/tmdb.js", () => ({
  tmdbTrendingForUiPage: trendingUi,
  tmdbSearchForUiPage: searchUi,
  tmdbFetchMovieImportPayload: moviePayload,
}));

vi.mock("../services/auditLog.js", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { writeAuditLog } from "../services/auditLog.js";
import { importMovieFromOmdb } from "../services/movieImportOmdb.js";
import { importMovieFromTmdb } from "../services/movieImportTmdb.js";

function authHeader(userId: string, role: "USER" | "ADMIN" = "USER") {
  return {
    Authorization: `Bearer ${signAccessToken({
      sub: userId,
      email: `${userId.slice(0, 6)}@test.dev`,
      role,
    })}`,
  };
}

describe("/api/movies routes", () => {
  let app: Express;
  const userId = randomUUID();
  const movieId = randomUUID();

  beforeEach(() => {
    app = createApp();
    catalogWhere.mockReset().mockResolvedValue({ id: { in: [movieId] } });
    catalogAccess.mockReset().mockResolvedValue(true);
    movieCount.mockReset().mockResolvedValue(1);
    movieFindMany.mockReset().mockResolvedValue([
      {
        id: movieId,
        imdbId: "tt1",
        tmdbId: 1,
        title: "Test Film",
        releaseYear: 2001,
        runtimeMinutes: 90,
        posterUrl: null,
        genres: [{ genre: { name: "Drama" } }],
        directors: [{ director: { name: "Dir" } }],
        externalRatings: [
          {
            source: "RT",
            ratingValue: 90,
            ratingScale: 100,
            ratingRaw: "90%",
          },
        ],
      },
    ]);
    movieFindUnique.mockReset().mockResolvedValue({
      id: movieId,
      imdbId: "tt9",
      tmdbId: 9,
      title: "Detail",
      releaseYear: 2010,
      runtimeMinutes: 100,
      synopsis: "Plot",
      posterUrl: null,
      genres: [{ genre: { name: "Action" } }],
      cast: [{ person: { name: "Actor" }, characterName: "Hero" }],
      directors: [{ director: { name: "Director Name" } }],
      externalRatings: [
        {
          source: "IMDB",
          ratingValue: 8,
          ratingScale: 10,
          ratingRaw: "8",
        },
      ],
    });
    userRatingFindUnique.mockReset().mockResolvedValue({ rating: 9 });
    hiddenDeleteMany.mockReset().mockResolvedValue({ count: 0 });

    trendingUi.mockReset().mockResolvedValue({ items: [], total: 0, pages: 1, page: 1, pageSize: 28 });
    searchUi.mockReset().mockResolvedValue({ items: [], total: 0, pages: 1, page: 1, pageSize: 28 });
    omdbSearch.mockReset().mockResolvedValue({ items: [], total: 0, page: 1 });
    omdbDetail.mockReset().mockResolvedValue({
      imdbId: "tt0095016",
      title: "Die Hard",
      year: "1988",
      type: "movie",
      posterUrl: null,
      plot: "",
      runtime: "",
      genre: "",
      imdbRating: 8,
      rottenTomatoesPercent: null,
      director: "",
      actors: "",
    });
    moviePayload.mockReset().mockResolvedValue({
      tmdbId: 1,
      imdbId: null,
      title: "Fetched",
      releaseYear: 2011,
      runtimeMinutes: 95,
      synopsis: "",
      posterUrl: null,
      genreNames: [],
      directors: [],
      cast: [],
      tmdbVoteAverage: null,
    });
    vi.mocked(importMovieFromOmdb).mockReset().mockResolvedValue({
      created: true,
      movie: {
        id: movieId,
        imdbId: "tt0095016",
        title: "Die Hard",
        releaseYear: 1988,
        runtimeMinutes: 132,
        synopsis: "",
        posterUrl: null,
      },
    });
    vi.mocked(importMovieFromTmdb).mockReset().mockResolvedValue({
      created: false,
      movie: {
        id: movieId,
        imdbId: null,
        tmdbId: 7,
        title: "Sequel",
        releaseYear: 2021,
        runtimeMinutes: 110,
        synopsis: "",
        posterUrl: null,
      },
    });
    vi.mocked(writeAuditLog).mockClear();
  });

  it("documents OMDb search results", async () => {
    omdbSearch.mockResolvedValueOnce({ items: [{ imdbId: "tt", title: "X", year: "2000", type: "", posterUrl: null }], total: 1, page: 1 });
    const res = await request(app).get("/api/movies/external/search").query({ q: "fight" });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("validates trending query params", async () => {
    const res = await request(app).get("/api/movies/external/tmdb/trending").query({ window: "day" });
    expect(res.status).toBe(200);
  });

  it("passes bearer context into structured search audits when possible", async () => {
    const res = await request(app)
      .get("/api/movies/external/tmdb/search")
      .set(authHeader(userId))
      .query({ q: "matrix" });
    expect(res.status).toBe(200);
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it("skips external TMDB audits when bearer tokens are malformed", async () => {
    const res = await request(app)
      .get("/api/movies/external/tmdb/search")
      .set({ Authorization: "Bearer not.a.jwt.token" })
      .query({ q: "blade" });
    expect(res.status).toBe(200);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("imports TMDB detail payloads without auth requirements", async () => {
    const res = await request(app).get("/api/movies/external/tmdb/movie/123");
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Fetched");
  });

  it("rejects malformed IMDB params", async () => {
    const res = await request(app).get("/api/movies/external/omdb/not-imdb-id");
    expect(res.status).toBe(400);
  });

  it("lists authenticated catalogue snapshots with auditing when filters supplied", async () => {
    const res = await request(app)
      .get("/api/movies/")
      .set(authHeader(userId))
      .query({ q: "needle" });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0].externalRatings[0]).toEqual({
      source: "RT",
      value: 90,
      scale: 100,
      raw: "90%",
    });
  });

  it("lists with text filters alone when admins have unrestricted visibility rows", async () => {
    catalogWhere.mockResolvedValueOnce(null);
    const containFilter = {
      title: { contains: "neo", mode: "insensitive" as const },
    };
    await request(app).get("/api/movies/").set(authHeader(userId)).query({ q: "neo" }).expect(200);
    expect(movieCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [containFilter] },
      }),
    );
    expect(movieFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [containFilter] },
      }),
    );
  });

  it("delegates catalogue list crashes to the error handler", async () => {
    movieFindMany.mockRejectedValueOnce(new Error("findMany outage"));
    const res = await request(app).get("/api/movies/").set(authHeader(userId)).query({ q: "x" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });

  it("lists catalogue pages without extra filters while still enforcing visibility mocks", async () => {
    const res = await request(app).get("/api/movies/").set(authHeader(userId));
    expect(res.status).toBe(200);
    expect(movieCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [movieId] } },
      }),
    );
  });

  it("applies stacked genre slices when querying cast and director facets", async () => {
    const res = await request(app)
      .get("/api/movies/")
      .set(authHeader(userId))
      .query({
        genre: "Drama",
        cast: "Meryl",
        director: "Eastwood",
        q: "bridges",
      });
    expect(res.status).toBe(200);
    const whereArg = movieFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] };
    expect(whereArg.AND).toHaveLength(5);
  });

  it("returns movie detail payloads for authorized patrons", async () => {
    const res = await request(app).get(`/api/movies/${movieId}`).set(authHeader(userId));
    expect(res.status).toBe(200);
    expect(res.body.userRating).toBe(9);
  });

  it("returns null user ratings when the patron has never scored the title", async () => {
    userRatingFindUnique.mockResolvedValueOnce(null);
    const res = await request(app).get(`/api/movies/${movieId}`).set(authHeader(userId));
    expect(res.status).toBe(200);
    expect(res.body.userRating).toBeNull();
  });

  it("delegates detail lookup failures to the error handler", async () => {
    movieFindUnique.mockRejectedValueOnce(new Error("unexpected db"));
    await request(app)
      .get(`/api/movies/${movieId}`)
      .set(authHeader(userId))
      .expect(500)
      .expect({ error: "Internal server error" });
  });

  it("responds 400 when detail ids are not UUID-shaped", async () => {
    const res = await request(app).get("/api/movies/not-a-uuid").set(authHeader(userId));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("responds 401 when bearer auth missing", async () => {
    const res = await request(app).get("/api/movies/");
    expect(res.status).toBe(401);
  });

  it("responds 404 for unknown catalogue ids", async () => {
    movieFindUnique.mockResolvedValueOnce(null);
    const missing = randomUUID();
    await request(app).get(`/api/movies/${missing}`).set(authHeader(userId)).expect(404);
  });

  it("responds 403-style 404 when movies are inaccessible", async () => {
    catalogAccess.mockResolvedValueOnce(false);
    await request(app).get(`/api/movies/${movieId}`).set(authHeader(userId)).expect(404);
  });

  it("supports OMDb imports with optimistic unhide", async () => {
    const res = await request(app)
      .post("/api/movies/import/omdb")
      .set(authHeader(userId))
      .send({ imdbId: "tt0095016" });
    expect(res.status).toBe(201);
    expect(hiddenDeleteMany).toHaveBeenCalled();
  });

  it("supports TMDB imports", async () => {
    await request(app)
      .post("/api/movies/import/tmdb")
      .set(authHeader(userId))
      .send({ tmdbId: 7 })
      .expect(200);
  });

  it("bubbles importer failures through the centralized error boundary", async () => {
    vi.mocked(importMovieFromOmdb).mockRejectedValueOnce(new Error("omdb outage"));
    const res = await request(app).post("/api/movies/import/omdb").set(authHeader(userId)).send({
      imdbId: "tt0095016",
    });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});

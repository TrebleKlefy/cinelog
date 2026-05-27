import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tmdb.js", () => ({
  tmdbFetchMovieImportPayload: vi.fn(),
  tmdbFetchMovieQuickPayload: vi.fn(),
}));

vi.mock("./omdb.js", () => ({
  omdbGetByImdbId: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  movie: {
    findUniqueOrThrow: vi.fn(),
  },
  person: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: prismaMock,
}));

import { tmdbFetchMovieImportPayload, tmdbFetchMovieQuickPayload } from "./tmdb.js";
import { omdbGetByImdbId } from "./omdb.js";
import { importMovieFromTmdb } from "./movieImportTmdb.js";

const quickPayload = {
  tmdbId: 42,
  imdbId: "tt0045152",
  title: "Singin' in the Rain",
  releaseYear: 1952,
  runtimeMinutes: 103,
  synopsis: "Classic",
  posterUrl: "/p.jpg",
  genreNames: ["Musical"],
  tmdbVoteAverage: 8.3,
};

describe("importMovieFromTmdb", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
    prismaMock.person.findFirst.mockReset().mockResolvedValue(null);
    prismaMock.person.create.mockReset().mockImplementation((args: { data: { name: string } }) =>
      Promise.resolve({
        id: `person-${args.data.name}`,
        name: args.data.name,
      }),
    );
    vi.mocked(omdbGetByImdbId).mockReset().mockRejectedValue(new Error("omdb unavailable"));
    vi.mocked(tmdbFetchMovieQuickPayload).mockReset();
    vi.mocked(tmdbFetchMovieImportPayload).mockReset();
  });

  it("rejects ids that cannot be normalized to ints", async () => {
    await expect(importMovieFromTmdb(Number.NaN)).rejects.toMatchObject({ status: 400 });
  });

  it("creates a fresh movie payload when nothing matches TMDB/imdb lookups", async () => {
    vi.mocked(tmdbFetchMovieQuickPayload).mockResolvedValue(quickPayload);
    vi.mocked(tmdbFetchMovieImportPayload).mockResolvedValue({
      ...quickPayload,
      directors: ["Gene Director"],
      cast: [{ name: "Gene Kelly", character: "Don Lockwood" }],
    });
    vi.mocked(omdbGetByImdbId).mockResolvedValue({
      imdbId: "tt0045152",
      title: "Singin' in the Rain",
      year: "1952",
      type: "movie",
      posterUrl: null,
      plot: "Classic",
      runtime: "103 min",
      genre: "Musical",
      imdbRating: 8.3,
      rottenTomatoesPercent: 100,
      director: "Gene Director",
      actors: "Gene Kelly",
    });

    const movieState = {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ id: "new-movie", imdbId: "tt0045152", tmdbId: 42 }),
      create: vi.fn().mockResolvedValue({
        id: "new-movie",
        imdbId: "tt0045152",
        tmdbId: 42,
        title: "Singin' in the Rain",
      }),
      update: vi.fn().mockResolvedValue({
        id: "new-movie",
        imdbId: "tt0045152",
        tmdbId: 42,
        title: "Singin' in the Rain",
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "new-movie",
        imdbId: "tt0045152",
        tmdbId: 42,
        title: "Singin' in the Rain",
        releaseYear: 1952,
        runtimeMinutes: 103,
        synopsis: "Classic",
        posterUrl: "/p.jpg",
      }),
    };

    const tx = {
      movie: movieState,
      movieGenre: { deleteMany: vi.fn(), create: vi.fn() },
      genre: {
        upsert: vi.fn().mockResolvedValue({ id: "genre-1", name: "Musical" }),
      },
      movieDirector: { deleteMany: vi.fn(), create: vi.fn() },
      movieCast: { deleteMany: vi.fn(), create: vi.fn() },
      movieExternalRating: {
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
    };

    prismaMock.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>, opts?: { timeout?: number }) => {
      expect(opts?.timeout).toBeGreaterThanOrEqual(10_000);
      return fn(tx);
    });

    prismaMock.movie.findUniqueOrThrow.mockImplementation(movieState.findUniqueOrThrow);

    const result = await importMovieFromTmdb(42);
    expect(result.created).toBe(true);
    expect(prismaMock.person.create).toHaveBeenCalled();
    expect(movieState.create).toHaveBeenCalled();
    expect(tx.movieExternalRating.upsert).toHaveBeenCalled();
    expect(tx.movieExternalRating.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          movieId_source: expect.objectContaining({
            source: "IMDB",
          }),
        }),
      }),
    );
    expect(tx.movieExternalRating.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          movieId_source: expect.objectContaining({
            source: "ROTTEN_TOMATOES",
          }),
        }),
      }),
    );
  });

  it("updates when a matching catalogue row exists", async () => {
    vi.mocked(tmdbFetchMovieQuickPayload).mockResolvedValue({
      tmdbId: 7,
      imdbId: null,
      title: "Updated Title",
      releaseYear: 2020,
      runtimeMinutes: 90,
      synopsis: null,
      posterUrl: null,
      genreNames: [],
      tmdbVoteAverage: null,
    });
    vi.mocked(tmdbFetchMovieImportPayload).mockResolvedValue({
      tmdbId: 7,
      imdbId: null,
      title: "Updated Title",
      releaseYear: 2020,
      runtimeMinutes: 90,
      synopsis: null,
      posterUrl: null,
      genreNames: [],
      directors: [],
      cast: [],
      tmdbVoteAverage: null,
    });

    const movieState = {
      findUnique: vi.fn().mockResolvedValue({ id: "old", imdbId: null, tmdbId: 7 }),
      update: vi.fn().mockResolvedValue({
        id: "old",
        imdbId: null,
        tmdbId: 7,
        title: "Updated Title",
      }),
      create: vi.fn(),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "old",
        imdbId: null,
        tmdbId: 7,
        title: "Updated Title",
        releaseYear: 2020,
        runtimeMinutes: 90,
        synopsis: null,
        posterUrl: null,
      }),
    };

    const tx = {
      movie: movieState,
      movieGenre: { deleteMany: vi.fn(), create: vi.fn() },
      genre: { upsert: vi.fn() },
      movieDirector: { deleteMany: vi.fn(), create: vi.fn() },
      movieCast: { deleteMany: vi.fn(), create: vi.fn() },
      movieExternalRating: {
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
    };

    prismaMock.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>, opts?: { timeout?: number }) => {
      expect(opts?.timeout).toBeGreaterThanOrEqual(10_000);
      return fn(tx);
    });

    prismaMock.movie.findUniqueOrThrow.mockImplementation(movieState.findUniqueOrThrow);

    const result = await importMovieFromTmdb(7);
    expect(result.created).toBe(false);
    expect(movieState.update).toHaveBeenCalled();
  });
});

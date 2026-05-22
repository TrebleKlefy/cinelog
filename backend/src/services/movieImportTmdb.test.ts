import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tmdb.js", () => ({
  tmdbFetchMovieImportPayload: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: prismaMock,
}));

import { tmdbFetchMovieImportPayload } from "./tmdb.js";
import { importMovieFromTmdb } from "./movieImportTmdb.js";

describe("importMovieFromTmdb", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
  });

  it("rejects ids that cannot be normalized to ints", async () => {
    await expect(importMovieFromTmdb(Number.NaN)).rejects.toMatchObject({ status: 400 });
  });

  it("creates a fresh movie payload when nothing matches TMDB/imdb lookups", async () => {
    vi.mocked(tmdbFetchMovieImportPayload).mockResolvedValue({
      tmdbId: 42,
      imdbId: "tt0045152",
      title: "Singin' in the Rain",
      releaseYear: 1952,
      runtimeMinutes: 103,
      synopsis: "Classic",
      posterUrl: "/p.jpg",
      genreNames: ["Musical"],
      directors: ["Gene Director"],
      cast: [{ name: "Gene Kelly", character: "Don Lockwood" }],
      tmdbVoteAverage: 8.3,
    });

    const movieState = {
      findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
      create: vi.fn().mockResolvedValue({
        id: "new-movie",
        imdbId: "tt0045152",
        tmdbId: 42,
        title: "Singin' in the Rain",
      }),
      update: vi.fn(),
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
      person: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args: { data: { name: string } }) => ({
          id: `person-${args.data.name}`,
          name: args.data.name,
        })),
      },
      movieExternalRating: {
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
    };

    prismaMock.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));

    const result = await importMovieFromTmdb(42);
    expect(result.created).toBe(true);
    expect(movieState.create).toHaveBeenCalled();
    expect(tx.movieExternalRating.upsert).toHaveBeenCalled();
  });

  it("updates when a matching catalogue row exists", async () => {
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
      findUnique: vi.fn().mockResolvedValueOnce({ id: "old", imdbId: null, tmdbId: 7 }),
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
      person: { findFirst: vi.fn(), create: vi.fn() },
      movieExternalRating: {
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
    };

    prismaMock.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));

    const result = await importMovieFromTmdb(7);
    expect(result.created).toBe(false);
    expect(movieState.update).toHaveBeenCalled();
  });
});

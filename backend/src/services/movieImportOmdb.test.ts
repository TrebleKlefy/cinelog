import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./omdb.js", () => ({
  omdbGetByImdbId: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: prismaMock,
}));

import { omdbGetByImdbId } from "./omdb.js";
import { importMovieFromOmdb } from "./movieImportOmdb.js";

describe("importMovieFromOmdb", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
    vi.mocked(omdbGetByImdbId).mockResolvedValue({
      imdbId: "tt0095016",
      title: "Die Hard",
      year: "1988",
      type: "movie",
      posterUrl: null,
      plot: null,
      runtime: "132 min",
      genre: "Action, Thriller",
      imdbRating: 8.2,
      rottenTomatoesPercent: 94,
      director: "John McTiernan",
      actors: "Bruce Willis, Alan Rickman",
    });
  });

  it("validates IMDB identifiers before hitting OMDb", async () => {
    await expect(importMovieFromOmdb("bad-id")).rejects.toMatchObject({ status: 400 });
  });

  it("parses malformed release years deterministically", async () => {
    vi.mocked(omdbGetByImdbId).mockResolvedValueOnce({
      imdbId: "tt0000001",
      title: "Broken",
      year: "Soon",
      type: "movie",
      posterUrl: null,
      plot: null,
      runtime: null,
      genre: null,
      imdbRating: null,
      rottenTomatoesPercent: null,
      director: null,
      actors: null,
    });
    await expect(importMovieFromOmdb("tt0000001")).rejects.toMatchObject({ status: 422 });
  });

  it("persists relational graph via prisma transaction callbacks", async () => {
    const tx = {
      movie: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          id: "movie-1",
          imdbId: "tt0095016",
          title: "Die Hard",
          releaseYear: 1988,
          runtimeMinutes: 132,
          synopsis: null,
          posterUrl: null,
        }),
      },
      movieGenre: { deleteMany: vi.fn(), create: vi.fn() },
      genre: {
        upsert: vi.fn().mockImplementation(async ({ create }: { create: { name: string } }) => ({
          id: `genre-${create.name}`,
          name: create.name,
        })),
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

    const result = await importMovieFromOmdb("tt0095016");
    expect(result.created).toBe(true);
    expect(result.movie.title).toBe("Die Hard");
    expect(tx.person.create).toHaveBeenCalled();
  });

  it("marks rows as unchanged when TMDB linkage already existed", async () => {
    const tx = {
      movie: {
        findUnique: vi.fn().mockResolvedValue({ id: "movie-existing" }),
        upsert: vi.fn().mockResolvedValue({
          id: "movie-existing",
          imdbId: "tt0095016",
          title: "Die Hard",
          releaseYear: 1988,
          runtimeMinutes: 132,
          synopsis: null,
          posterUrl: null,
        }),
      },
      movieGenre: { deleteMany: vi.fn(), create: vi.fn() },
      genre: {
        upsert: vi.fn().mockImplementation(async ({ create }: { create: { name: string } }) => ({
          id: `genre-${create.name}`,
          name: create.name,
        })),
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

    const result = await importMovieFromOmdb("tt0095016");
    expect(result.created).toBe(false);
  });

  it("clears external aggregators when ratings are omitted", async () => {
    vi.mocked(omdbGetByImdbId).mockResolvedValueOnce({
      imdbId: "tt1234567",
      title: "No Scores",
      year: "2000",
      type: "movie",
      posterUrl: null,
      plot: null,
      runtime: null,
      genre: null,
      imdbRating: null,
      rottenTomatoesPercent: null,
      director: null,
      actors: null,
    });

    const tx = {
      movie: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          id: "movie-2",
          imdbId: "tt1234567",
          title: "No Scores",
          releaseYear: 2000,
          runtimeMinutes: null,
          synopsis: null,
          posterUrl: null,
        }),
      },
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

    await importMovieFromOmdb("tt1234567");

    expect(tx.movieExternalRating.deleteMany).toHaveBeenCalledTimes(2);
    expect(tx.movieExternalRating.upsert).not.toHaveBeenCalled();
  });
});

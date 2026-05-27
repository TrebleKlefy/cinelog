import { AuditActionType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditFindMany: vi.fn(),
  collectionFindMany: vi.fn(),
  ratingFindMany: vi.fn(),
  hiddenFindMany: vi.fn(),
  hiddenFindUnique: vi.fn(),
  movieFindMany: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    auditLog: { findMany: mocks.auditFindMany },
    collectionMovie: { findMany: mocks.collectionFindMany },
    userMovieRating: { findMany: mocks.ratingFindMany },
    userHiddenMovie: { findMany: mocks.hiddenFindMany, findUnique: mocks.hiddenFindUnique },
    movie: { findMany: mocks.movieFindMany },
  },
}));

import {
  collectAccessibleMovieIds,
  collectAccessibleTmdbIds,
  movieVisibilityWhere,
  userCanAccessMovie,
} from "./movieCatalogScope.js";

describe("collectAccessibleMovieIds", () => {
  beforeEach(() => {
    mocks.auditFindMany.mockResolvedValue([]);
    mocks.collectionFindMany.mockResolvedValue([]);
    mocks.ratingFindMany.mockResolvedValue([]);
    mocks.hiddenFindMany.mockResolvedValue([]);
  });

  it("merges imports, shelf, ratings and excludes hidden", async () => {
    mocks.auditFindMany.mockResolvedValue([{ resourceId: "m1" }]);
    mocks.collectionFindMany.mockResolvedValue([{ movieId: "m2" }]);
    mocks.ratingFindMany.mockResolvedValue([{ movieId: "m3" }]);
    mocks.hiddenFindMany.mockResolvedValue([{ movieId: "m2" }]);

    const ids = await collectAccessibleMovieIds("user-a");
    expect(ids.sort()).toEqual(["m1", "m3"].sort());
    expect(mocks.auditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          actionType: { in: [AuditActionType.MOVIE_IMPORT_TMDB, AuditActionType.MOVIE_IMPORT_OMDB] },
        }),
      }),
    );
  });

  it("drops import rows missing resourceId", async () => {
    mocks.auditFindMany.mockResolvedValue([{ resourceId: null }]);
    mocks.collectionFindMany.mockResolvedValue([{ movieId: "m9" }]);
    mocks.ratingFindMany.mockResolvedValue([]);
    mocks.hiddenFindMany.mockResolvedValue([]);

    await expect(collectAccessibleMovieIds("user-b")).resolves.toEqual(["m9"]);
  });
});

describe("collectAccessibleTmdbIds", () => {
  beforeEach(() => {
    mocks.auditFindMany.mockResolvedValue([]);
    mocks.collectionFindMany.mockResolvedValue([]);
    mocks.ratingFindMany.mockResolvedValue([]);
    mocks.hiddenFindMany.mockResolvedValue([]);
    mocks.movieFindMany.mockReset();
  });

  it("returns unique TMDB ids for accessible movies", async () => {
    mocks.auditFindMany.mockResolvedValue([{ resourceId: "m1" }, { resourceId: "m2" }]);
    mocks.movieFindMany.mockResolvedValue([{ tmdbId: 42 }, { tmdbId: 42 }, { tmdbId: 99 }]);

    await expect(collectAccessibleTmdbIds("user-a")).resolves.toEqual([42, 99]);
  });

  it("returns empty when user has no accessible movies", async () => {
    await expect(collectAccessibleTmdbIds("user-empty")).resolves.toEqual([]);
    expect(mocks.movieFindMany).not.toHaveBeenCalled();
  });
});

describe("movieVisibilityWhere", () => {
  beforeEach(() => {
    mocks.auditFindMany.mockResolvedValue([]);
    mocks.collectionFindMany.mockResolvedValue([]);
    mocks.ratingFindMany.mockResolvedValue([]);
    mocks.hiddenFindMany.mockResolvedValue([]);
  });

  it("returns null for admin with no hidden movies", async () => {
    const w = await movieVisibilityWhere("ADMIN", "adm");
    expect(w).toBeNull();
  });

  it("admin still respects hidden exclusions", async () => {
    mocks.hiddenFindMany.mockResolvedValue([{ movieId: "h1" }]);
    const w = await movieVisibilityWhere("ADMIN", "adm");
    expect(w).toEqual({ id: { notIn: ["h1"] } });
  });

  it("user with accessible ids constrains list", async () => {
    mocks.hiddenFindMany.mockResolvedValue([]);
    mocks.auditFindMany.mockResolvedValue([{ resourceId: "mid" }]);
    const w = await movieVisibilityWhere("USER", "u1");
    expect(w).toEqual({ id: { in: ["mid"] } });
  });

  it("user with zero accessible ids yields empty sentinel", async () => {
    const w = await movieVisibilityWhere("USER", "none");
    expect(w).toEqual({ id: { in: ["00000000-0000-0000-0000-000000000000"] } });
  });
});

describe("userCanAccessMovie", () => {
  beforeEach(() => {
    mocks.hiddenFindUnique.mockResolvedValue(null);
    mocks.auditFindMany.mockResolvedValue([]);
    mocks.collectionFindMany.mockResolvedValue([]);
    mocks.ratingFindMany.mockResolvedValue([]);
    mocks.hiddenFindMany.mockResolvedValue([]);
  });

  it("returns false when movie is explicitly hidden", async () => {
    mocks.hiddenFindUnique.mockResolvedValue({ movieId: "m1" });
    await expect(userCanAccessMovie("USER", "u1", "m1")).resolves.toBe(false);
    await expect(userCanAccessMovie("ADMIN", "a1", "m1")).resolves.toBe(false);
  });

  it("ADMIN can access otherwise", async () => {
    await expect(userCanAccessMovie("ADMIN", "a1", "anything")).resolves.toBe(true);
  });

  it("USER requires membership in collected ids", async () => {
    mocks.auditFindMany.mockResolvedValue([{ resourceId: "in-list" }]);
    await expect(userCanAccessMovie("USER", "u1", "in-list")).resolves.toBe(true);
    await expect(userCanAccessMovie("USER", "u1", "missing")).resolves.toBe(false);
  });
});

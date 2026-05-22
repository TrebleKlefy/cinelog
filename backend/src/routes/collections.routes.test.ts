import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import type { Express } from "express";

const collFindUnique = vi.hoisted(() => vi.fn());
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    userCollection: {
      findUnique: collFindUnique,
    },
  },
}));

describe("/api/collections/:slug", () => {
  let app: Express;
  beforeEach(() => {
    app = createApp();
    collFindUnique.mockReset();
  });

  const filmId = randomUUID();

  it("returns curated public shelves", async () => {
    collFindUnique.mockResolvedValueOnce({
      slug: "demo",
      title: "Shelf",
      isPublic: true,
      user: { displayName: "Owner" },
      movies: [],
    });
    await request(app).get("/api/collections/demo").expect(200);
  });

  it("serializes rating facets for public shelf previews", async () => {
    collFindUnique.mockResolvedValueOnce({
      slug: "featured",
      title: "Spotlight",
      isPublic: true,
      user: { displayName: "Curator" },
      movies: [
        {
          addedAt: new Date("2026-01-10T00:00:00.000Z"),
          notes: "Must watch",
          movie: {
            id: filmId,
            imdbId: "tt987",
            tmdbId: 55,
            title: "City Lights",
            releaseYear: 1931,
            runtimeMinutes: 87,
            posterUrl: "/poster.jpg",
            genres: [{ genre: { name: "Comedy" } }],
            externalRatings: [{ source: "IMDB", ratingValue: 8.5, ratingScale: 10, ratingRaw: "8.5" }],
          },
        },
      ],
    });

    const res = await request(app).get("/api/collections/featured").expect(200);

    expect(res.body.movies[0]?.movie.genres).toEqual(["Comedy"]);
    expect(res.body.movies[0]?.movie.externalRatings[0]).toEqual({
      source: "IMDB",
      value: 8.5,
      scale: 10,
      raw: "8.5",
    });
  });

  it("hides private collections", async () => {
    collFindUnique.mockResolvedValueOnce({
      slug: "secret",
      title: "Nope",
      isPublic: false,
      user: { displayName: "Owner" },
      movies: [],
    });
    await request(app).get("/api/collections/secret").expect(404);
  });

  it("responds 404 for unknown slug lookups", async () => {
    collFindUnique.mockResolvedValueOnce(null);
    await request(app).get("/api/collections/ghost-slug").expect(404);
  });
});

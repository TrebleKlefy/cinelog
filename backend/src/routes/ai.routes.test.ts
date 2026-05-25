import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { signAccessToken } from "../lib/jwt.js";
import * as llm from "../services/llm.js";
import * as bootstrap from "../services/movieAgentBootstrap.js";

// quick fix to get the tests to pass
const prisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  movie: { findMany: vi.fn() },
  userMovieRating: { findMany: vi.fn() },
  userCollection: { findFirst: vi.fn() },
  appSettings: { findUniqueOrThrow: vi.fn() },
}));

const movieCatalogWhere = vi.hoisted(() => vi.fn());

const streamMovieAgentChatMock = vi.hoisted(() =>
  vi.fn(async ({ res }: { res: { status: (code: number) => { end: () => void } } }) => {
    res.status(200).end();
  }),
);

vi.mock("../services/movieAgentChat.js", () => ({
  streamMovieAgentChat: (...args: unknown[]) => streamMovieAgentChatMock(...args),
}));

vi.mock("../lib/prisma.js", () => ({ prisma }));

vi.mock("../services/movieCatalogScope.js", () => ({
  movieVisibilityWhere: (...args: unknown[]) => movieCatalogWhere(...args),
}));

vi.mock("../services/auditLog.js", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

describe("/api/ai", () => {
  let app: Express;
  const userId = randomUUID();
  const movieId = randomUUID();

  const headers = () => ({
    Authorization: `Bearer ${signAccessToken({
      sub: userId,
      email: "ai-user@test.dev",
      role: "USER",
    })}`,
  });

  beforeEach(() => {
    app = createApp();
    prisma.user.findUnique.mockReset().mockResolvedValue({
      id: userId,
      email: "ai-user@test.dev",
      role: "USER",
    });
    prisma.userMovieRating.findMany.mockReset().mockResolvedValue([]);
    prisma.appSettings.findUniqueOrThrow.mockReset().mockResolvedValue({
      activeProvider: { providerKey: "groq" },
      activeModel: { modelKey: "llama-mini" },
    });
    prisma.userCollection.findFirst.mockReset().mockResolvedValue({
      movies: [
        {
          movie: {
            title: "Interstellar",
            releaseYear: 2014,
            genres: [{ genre: { name: "Sci-Fi" } }],
          },
        },
      ],
    });

    prisma.movie.findMany.mockReset();

    movieCatalogWhere.mockReset().mockResolvedValue(null);

    vi.spyOn(llm, "runNlSearchWithActiveLlm").mockResolvedValue({
      result: { matches: [{ title: "Inception", year: 2010, movieId, reason: "dreams" }] },
      config: { providerKey: "groq", modelKey: "llama-mini" },
      usedLiveLlm: true,
    });
    vi.spyOn(llm, "runRecommendationsWithActiveLlm").mockResolvedValue({
      result: {
        recommendations: [
          {
            title: "Rec",
            year: 2015,
            movieId,
            why: "space",
            posterUrl: undefined,
            tmdbId: null,
          },
        ],
        disclaimer: "unit disclaimer",
      },
      config: { providerKey: "groq", modelKey: "llama-mini" },
      usedLiveLlm: false,
    });
    vi.spyOn(bootstrap, "buildMovieAgentBootstrap").mockResolvedValue({
      trendingToday: [],
      topRated: [],
      nowPlaying: [],
      contextForLlm: "digest-body",
    });
    streamMovieAgentChatMock.mockReset().mockImplementation(async ({ res }: { res: { status: (n: number) => { end: () => void } } }) => {
      res.status(200).end();
    });
  });

  it("executes concierge NL searches with audited metadata", async () => {
    prisma.movie.findMany.mockResolvedValueOnce([
      { id: movieId, title: "Inception", releaseYear: 2010 },
    ]);
    const res = await request(app).post("/api/ai/nl-search").set(headers()).send({ query: "mind heist" });
    expect(res.status).toBe(200);
    expect(res.body.matches[0]?.movieId).toBe(movieId);
  });

  it("rejects tiny NL payloads", async () => {
    const res = await request(app).post("/api/ai/nl-search").set(headers()).send({ query: "x" });
    expect(res.status).toBe(400);
  });

  it("renders personalization recommendations plus poster hydrate", async () => {
    prisma.movie.findMany
      .mockResolvedValueOnce([{ id: movieId, title: "Rec", releaseYear: 2015 }])
      .mockResolvedValueOnce([{ id: movieId, posterUrl: "/poster.jpg" }]);

    const res = await request(app).post("/api/ai/recommendations").set(headers()).send({});
    expect(res.status).toBe(200);
    expect(res.body.recommendations[0].posterUrl).toBe("/poster.jpg");
  });

  it("loads bootstrap previews from TMDB shims", async () => {
    const res = await request(app).get("/api/ai/agent/bootstrap").set(headers());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.trendingToday)).toBe(true);
  });

  it("streams conversational movies via concierge pipeline", async () => {
    const res = await request(app).post("/api/ai/agent/chat").set(headers()).send({
      messages: [{ role: "user", content: "Suggest something cerebral" }],
    });
    expect(res.status).toBe(200);
    expect(streamMovieAgentChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Suggest something cerebral" }],
      }),
    );
  });

  it("demands bearer auth tokens", async () => {
    await request(app).post("/api/ai/nl-search").send({ query: "hello ai" }).expect(401);
  });

  it("threads catalog visibility predicates into prisma movie scans", async () => {
    const vis = { id: { in: [movieId] } };
    movieCatalogWhere.mockResolvedValueOnce(vis);
    prisma.movie.findMany.mockResolvedValueOnce([{ id: movieId, title: "Inception", releaseYear: 2010 }]);
    const res = await request(app).post("/api/ai/nl-search").set(headers()).send({ query: "heist vibes" });
    expect(res.status).toBe(200);
    expect(prisma.movie.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: vis }));
  });

  it("builds personalization context from ratings when shelves are absent", async () => {
    prisma.userCollection.findFirst.mockResolvedValueOnce(null);
    prisma.userMovieRating.findMany.mockResolvedValueOnce([
      { rating: 9, movie: { title: "Arrival", releaseYear: 2016 } },
    ]);
    prisma.movie.findMany.mockResolvedValueOnce([{ id: movieId, title: "Rec", releaseYear: 2015 }]);
    prisma.movie.findMany.mockResolvedValueOnce([{ id: movieId, posterUrl: "/p.jpg" }]);

    await request(app).post("/api/ai/recommendations").set(headers()).send({}).expect(200);
    expect(llm.runRecommendationsWithActiveLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        historyContext: expect.stringContaining("Arrival"),
      }),
    );
  });

  it("skips poster hydration when the resolver already inlined artwork", async () => {
    vi.spyOn(llm, "runRecommendationsWithActiveLlm").mockResolvedValueOnce({
      result: {
        recommendations: [{ title: "T", year: 2015, movieId, why: "x", posterUrl: "https://cdn/x.jpg", tmdbId: null }],
        disclaimer: "",
      },
      config: { providerKey: "groq", modelKey: "llama-mini" },
      usedLiveLlm: false,
    });

    prisma.movie.findMany.mockResolvedValueOnce([{ id: movieId, title: "Hold", releaseYear: 2001 }]);
    prisma.movie.findMany.mockResolvedValueOnce([]);

    const res = await request(app).post("/api/ai/recommendations").set(headers()).send({});
    expect(res.status).toBe(200);
    expect(res.body.recommendations[0].posterUrl).toBe("https://cdn/x.jpg");
  });

  it("responds 400 when conversational transcripts break schema guards", async () => {
    const res = await request(app).post("/api/ai/agent/chat").set(headers()).send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it("surfaces TMDB bootstrap failures through the centralized error boundary", async () => {
    vi.spyOn(bootstrap, "buildMovieAgentBootstrap").mockRejectedValueOnce(new Error("digest unavailable"));
    const res = await request(app).get("/api/ai/agent/bootstrap").set(headers());
    expect(res.status).toBe(500);
  });

  it("delegates NL search prisma failures downstream", async () => {
    prisma.movie.findMany.mockRejectedValueOnce(new Error("offline"));
    const res = await request(app).post("/api/ai/nl-search").set(headers()).send({ query: "robots in space" });
    expect(res.status).toBe(500);
  });
});

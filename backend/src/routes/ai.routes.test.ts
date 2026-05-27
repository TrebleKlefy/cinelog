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
const hydrateNlSearchMatchesMock = vi.hoisted(() => vi.fn());

vi.mock("../services/recommendationResolve.js", () => ({
  hydrateNlSearchMatches: (...args: unknown[]) => hydrateNlSearchMatchesMock(...args),
}));

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
      result: { matches: [{ title: "Inception", year: 2010, reason: "dreams" }] },
      config: { providerKey: "groq", modelKey: "llama-mini" },
      usedLiveLlm: true,
    });
    vi.spyOn(llm, "runRecommendationsWithActiveLlm").mockResolvedValue({
      result: {
        recommendations: [
          {
            title: "Rec",
            year: 2015,
            why: "space",
            posterUrl: "https://cdn/poster.jpg",
            tmdbId: 123,
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
    hydrateNlSearchMatchesMock.mockReset().mockImplementation(async (matches: Array<{ title: string; year?: number; movieId?: string; reason: string }>) =>
      matches.map((m) => ({
        ...m,
        tmdbId: 27205,
        posterUrl: "https://image.tmdb.org/t/p/w500/inception.jpg",
        voteAverage: 8.8,
      })),
    );
  });

  it("executes concierge NL searches with audited metadata", async () => {
    const res = await request(app).post("/api/ai/nl-search").set(headers()).send({ query: "mind heist" });
    expect(res.status).toBe(200);
    expect(res.body.matches[0]?.tmdbId).toBe(27205);
    expect(res.body.matches[0]?.posterUrl).toContain("inception.jpg");
    expect(hydrateNlSearchMatchesMock).toHaveBeenCalled();
  });

  it("rejects tiny NL payloads", async () => {
    const res = await request(app).post("/api/ai/nl-search").set(headers()).send({ query: "x" });
    expect(res.status).toBe(400);
  });

  it("returns TMDB-backed recommendations", async () => {
    const res = await request(app).post("/api/ai/recommendations").set(headers()).send({});
    expect(res.status).toBe(200);
    expect(res.body.recommendations[0].posterUrl).toBe("https://cdn/poster.jpg");
    expect(res.body.recommendations[0].tmdbId).toBe(123);
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

  it("builds personalization context from ratings when shelves are absent", async () => {
    prisma.userCollection.findFirst.mockResolvedValueOnce(null);
    prisma.userMovieRating.findMany.mockResolvedValueOnce([
      { rating: 9, movie: { title: "Arrival", releaseYear: 2016 } },
    ]);

    await request(app).post("/api/ai/recommendations").set(headers()).send({}).expect(200);
    expect(llm.runRecommendationsWithActiveLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        historyContext: expect.stringContaining("Arrival"),
      }),
    );
  });

  it("returns recommendation payloads from the resolver unchanged", async () => {
    vi.spyOn(llm, "runRecommendationsWithActiveLlm").mockResolvedValueOnce({
      result: {
        recommendations: [{ title: "T", year: 2015, why: "x", posterUrl: "https://cdn/x.jpg", tmdbId: 999 }],
        disclaimer: "",
      },
      config: { providerKey: "groq", modelKey: "llama-mini" },
      usedLiveLlm: false,
    });

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

  it("delegates NL search LLM failures downstream", async () => {
    vi.spyOn(llm, "runNlSearchWithActiveLlm").mockRejectedValueOnce(new Error("offline"));
    const res = await request(app).post("/api/ai/nl-search").set(headers()).send({ query: "robots in space" });
    expect(res.status).toBe(500);
  });

  it("delegates recommendation LLM failures downstream", async () => {
    vi.spyOn(llm, "runRecommendationsWithActiveLlm").mockRejectedValueOnce(new Error("reco offline"));
    const res = await request(app).post("/api/ai/recommendations").set(headers()).send({});
    expect(res.status).toBe(500);
  });
});

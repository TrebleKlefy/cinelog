import { describe, expect, it, vi } from "vitest";

const tmdbMocks = vi.hoisted(() => ({
  trending: vi.fn(),
  browse: vi.fn(),
}));

vi.mock("./tmdb.js", () => ({
  tmdbTrendingMovies: tmdbMocks.trending,
  tmdbMovieBrowseList: tmdbMocks.browse,
}));

import { buildMovieAgentBootstrap } from "./movieAgentBootstrap.js";

describe("buildMovieAgentBootstrap", () => {
  it("assembles TMDB shelves + descriptive digest text", async () => {
    const item = {
      tmdbId: 11,
      title: "Neo Noir",
      releaseYear: 2015,
      posterUrl: "/p.jpg",
      voteAverage: 7.77,
    };
    tmdbMocks.trending.mockResolvedValue({ items: [item], total: 1, page: 1, pages: 1 });
    tmdbMocks.browse.mockResolvedValue({ items: [], total: 0, page: 1, pages: 1 });

    const boot = await buildMovieAgentBootstrap();
    expect(boot.trendingToday[0]?.title).toBe("Neo Noir");
    expect(boot.contextForLlm).toContain("Buzzing TODAY");
    expect(boot.contextForLlm).toContain("none returned");
  });

  it("shows placeholder rating markers when TMDB omits community scores", async () => {
    tmdbMocks.trending.mockResolvedValue({ items: [], total: 0, page: 1, pages: 1 });
    tmdbMocks.browse.mockResolvedValue({
      items: [{ tmdbId: 77, title: "Mystery", releaseYear: null, posterUrl: null, voteAverage: null }],
      total: 1,
      page: 1,
      pages: 1,
    });

    const boot = await buildMovieAgentBootstrap();
    expect(boot.contextForLlm).toMatch(/rating \?\//);
  });
});

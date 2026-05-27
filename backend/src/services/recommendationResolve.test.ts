import { afterEach, describe, expect, it, vi } from "vitest";

import * as llm from "./llm.js";
import * as tmdb from "./tmdb.js";
import { resolveTitleToTmdbBest, hydrateNlSearchMatches, runLiveRecommendationsWithTmdbRetry } from "./recommendationResolve.js";

describe("resolveTitleToTmdbBest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null on empty query", async () => {
    await expect(resolveTitleToTmdbBest("   ")).resolves.toBeNull();
  });

  it("returns null when TMDB search errors", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockRejectedValueOnce(new Error("network"));
    await expect(resolveTitleToTmdbBest("Alien", 1979)).resolves.toBeNull();
  });

  it("returns null when TMDB search returns zero rows", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pages: 1,
    });
    await expect(resolveTitleToTmdbBest("Zorgon", 2001)).resolves.toBeNull();
  });

  it("clips extremely long TMDB lookup strings before searching", async () => {
    const spy = vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pages: 1,
    });
    await resolveTitleToTmdbBest("x".repeat(220), undefined);
    const searched = spy.mock.calls[0]?.[0] as string;
    expect(searched.length).toBeLessThanOrEqual(180);
  });

  it("does not tack on a bogus year clamp when callers omit release years", async () => {
    const spy = vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pages: 1,
    });
    await resolveTitleToTmdbBest("Parasite");
    expect(spy.mock.calls[0]?.[0]).toBe("Parasite");
  });

  it("returns null when confidence is too low", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValueOnce({
      items: [
        {
          tmdbId: 1,
          title: "Something Else Entirely",
          releaseYear: 1999,
          posterUrl: null,
          voteAverage: null,
        },
        {
          tmdbId: 2,
          title: "Another different title",
          releaseYear: 2005,
          posterUrl: null,
          voteAverage: null,
        },
      ],
      total: 2,
      page: 1,
      pages: 1,
    });
    await expect(resolveTitleToTmdbBest("Alien", 1979)).resolves.toBeNull();
  });

  it("accepts lone weak hits with softened threshold", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValueOnce({
      items: [
        {
          tmdbId: 33,
          title: "Alien",
          releaseYear: 1979,
          posterUrl: null,
          voteAverage: 8,
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
    });
    const hit = await resolveTitleToTmdbBest("Alien", 1979);
    expect(hit?.tmdbId).toBe(33);
  });

  it("returns best multi-hit match", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValueOnce({
      items: [
        {
          tmdbId: 1,
          title: "Alien: Covenant",
          releaseYear: 2017,
          posterUrl: null,
          voteAverage: 6,
        },
        {
          tmdbId: 2,
          title: "Alien",
          releaseYear: 1979,
          posterUrl: null,
          voteAverage: 9,
        },
      ],
      total: 2,
      page: 1,
      pages: 1,
    });
    const hit = await resolveTitleToTmdbBest("Alien", 1979);
    expect(hit?.tmdbId).toBe(2);
  });

  it("prioritizes colon-titled franchises when subtitles align", async () => {
    /** 'matrix:' prefix branch + exact year boosts confidence past the multi-hit floor */
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValueOnce({
      items: [
        {
          tmdbId: 101,
          title: "Totally unrelated zombie flick",
          releaseYear: 2003,
          posterUrl: null,
          voteAverage: 5,
        },
        {
          tmdbId: 604,
          title: "matrix: revolutions",
          releaseYear: 2003,
          posterUrl: "/m3.jpg",
          voteAverage: 6.5,
        },
      ],
      total: 2,
      page: 1,
      pages: 1,
    });

    const hit = await resolveTitleToTmdbBest("Matrix", 2003);
    expect(hit?.tmdbId).toBe(604);
  });

  it("still aligns release years within one notch of the curator hint", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValueOnce({
      items: [
        {
          tmdbId: 77,
          title: "blade runner",
          releaseYear: 1983,
          posterUrl: null,
          voteAverage: 9,
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
    });
    /** Request 1982, TMDB lists 1983 → yr delta +18 still clears soft single-hit floor */
    const hit = await resolveTitleToTmdbBest("Blade Runner", 1982);
    expect(hit?.tmdbId).toBe(77);
  });

  it("returns null when the release gap is too steep for ambiguous hits", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValueOnce({
      items: [
        {
          tmdbId: 9,
          title: "blade runner",
          releaseYear: 1990,
          posterUrl: null,
          voteAverage: 9,
        },
        {
          tmdbId: 10,
          title: "noise title",
          releaseYear: 1982,
          posterUrl: null,
          voteAverage: 9,
        },
      ],
      total: 2,
      page: 1,
      pages: 1,
    });

    /** Multi-hit path requires score ≥95; punitive year deltas should reject the lone plausible row */
    await expect(resolveTitleToTmdbBest("Blade Runner", 1982)).resolves.toBeNull();
  });
});

describe("runLiveRecommendationsWithTmdbRetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const config = { providerKey: "groq" as const, modelKey: "m" };

  it("throws when the first model payload is empty", async () => {
    vi.spyOn(llm, "chatCompletionActiveModel").mockResolvedValueOnce(JSON.stringify({ recommendations: [] }));

    await expect(runLiveRecommendationsWithTmdbRetry({ historyContext: "ctx" }, config)).rejects.toThrow(
      "zero usable rows",
    );
  });

  it("hydrates recommendations from TMDB matches", async () => {
    const seedTitles = Array.from({ length: 11 }, (_, i) => `Catalog Title ${i}`);
    vi.spyOn(tmdb, "tmdbSearchMovies").mockImplementation(async (q: string) => {
      const hit = seedTitles.find((title) => q.includes(title));
      if (!hit) return { items: [], total: 0, page: 1, pages: 1 };
      const idx = seedTitles.indexOf(hit);
      return {
        items: [
          {
            tmdbId: 1000 + idx,
            title: hit,
            releaseYear: 2000 + idx,
            posterUrl: `/p-${idx}.jpg`,
            voteAverage: 8,
          },
        ],
        total: 1,
        page: 1,
        pages: 1,
      };
    });

    const initial = {
      recommendations: seedTitles.map((title, i) => ({
        title,
        year: 2000 + i,
        why: "Because tests",
      })),
      disclaimer: "unit",
    };
    vi.spyOn(llm, "chatCompletionActiveModel").mockResolvedValueOnce(JSON.stringify(initial));

    const out = await runLiveRecommendationsWithTmdbRetry({ historyContext: "ctx" }, config);
    expect(out.recommendations).toHaveLength(7);
    expect(out.recommendations.every((r) => r.why === "Because tests")).toBe(true);
    expect(out.recommendations.every((r) => r.tmdbId != null)).toBe(true);
    expect(out.disclaimer).toContain("unit");
    expect(out.disclaimer).not.toMatch(/TMDB-aligned salvage wave/);
  });

  it("skips duplicate brainstorm rows keyed by canonical title/year", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValue({
      items: [
        {
          tmdbId: 42,
          title: "Shared Title",
          releaseYear: 2010,
          posterUrl: "/p.jpg",
          voteAverage: 8,
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
    });

    const rows = Array.from({ length: 11 }, (_, idx) =>
      idx === 1 ? { title: "Shared Title", year: 2010, why: "dup" } : { title: `Unique ${idx}`, year: 2010 + idx, why: "uniq" },
    );
    vi.spyOn(llm, "chatCompletionActiveModel").mockResolvedValueOnce(JSON.stringify({ recommendations: rows }));

    const out = await runLiveRecommendationsWithTmdbRetry({ historyContext: "ctx" }, config);
    expect(out.recommendations.length).toBeGreaterThan(0);
    expect(out.recommendations.filter((r) => r.title === "Shared Title")).toHaveLength(1);
  });

  it("enriches unseen titles via TMDB when catalog verification fails", async () => {
    const tmdbHits = ["Helios Alpha", "Helios Beta", "Helios Gamma", "Helios Delta", "Helios Epsilon", "Helios Zeta", "Helios Eta"];
    vi.spyOn(tmdb, "tmdbSearchMovies").mockImplementation(async (q: string) => {
      const title = [...tmdbHits].sort((a, b) => b.length - a.length).find((h) => q.toLowerCase().includes(h.toLowerCase()));
      if (!title)
        return { items: [], total: 0, page: 1, pages: 1 };

      const tmdbId = 500 + tmdbHits.indexOf(title);
      return {
        items: [
          {
            tmdbId,
            title,
            releaseYear: 2024,
            posterUrl: `https://poster/${tmdbId}.jpg`,
            voteAverage: 8,
          },
        ],
        total: 1,
        page: 1,
        pages: 1,
      };
    });

    const initial = {
      recommendations: tmdbHits.map((title) => ({ title, year: 2024, why: "off-catalog" })),
    };
    vi.spyOn(llm, "chatCompletionActiveModel").mockResolvedValueOnce(JSON.stringify(initial));

    const out = await runLiveRecommendationsWithTmdbRetry({ historyContext: "space opera" }, config);
    expect(out.recommendations).toHaveLength(7);
    expect(out.recommendations.every((r) => r.tmdbId != null)).toBe(true);
    expect(out.recommendations.every((r) => r.movieId == null)).toBe(true);
  });

  it("runs TMDB salvage waves when the shortlist cannot be verified", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockImplementation(async (q: string) => {
      if (q.includes("ZZZ-FAIL")) {
        return { items: [], total: 0, page: 1, pages: 1 };
      }
      return {
        items: [
          {
            tmdbId: 9001,
            title: "Salvage Hit One",
            releaseYear: 2011,
            posterUrl: null,
            voteAverage: 8,
          },
        ],
        total: 1,
        page: 1,
        pages: 1,
      };
    });

    const broken = Array.from({ length: 11 }, (_, i) => ({
      title: `ZZZ-FAIL ${i}`,
      year: 2005,
      why: "will miss",
    }));

    const salvagePayload = {
      recommendations: Array.from({ length: 12 }, (_, i) => ({
        title: i < 7 ? "Salvage Hit One" : `Salvage Noise ${i}`,
        year: 2011,
        why: "replacement",
      })),
    };

    vi.spyOn(llm, "chatCompletionActiveModel")
      .mockResolvedValueOnce(JSON.stringify({ recommendations: broken }))
      .mockResolvedValueOnce(JSON.stringify(salvagePayload));

    const out = await runLiveRecommendationsWithTmdbRetry({ historyContext: "big fan of sci-fi" }, config);
    expect(out.recommendations.length).toBeGreaterThan(0);
    expect(out.disclaimer).toMatch(/TMDB-aligned salvage wave/);
  });

  it("restores the reject backlog when salvage JSON cannot be parsed", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValue({ items: [], total: 0, page: 1, pages: 1 });

    const broken = Array.from({ length: 11 }, (_, i) => ({
      title: `NOPE-${i}`,
      year: 1999,
      why: "x",
    }));

    vi.spyOn(llm, "chatCompletionActiveModel")
      .mockResolvedValueOnce(JSON.stringify({ recommendations: broken }))
      .mockResolvedValueOnce("not-json at all");

    const out = await runLiveRecommendationsWithTmdbRetry({ historyContext: "ctx" }, config);
    expect(out.disclaimer).toMatch(/Salvage pass .* failed during JSON ingest/);
  });

  it("stops salvage when the replacement model returns zero rows", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValue({ items: [], total: 0, page: 1, pages: 1 });

    const broken = Array.from({ length: 11 }, (_, i) => ({
      title: `EMPTY-${i}`,
      year: 1999,
      why: "x",
    }));

    vi.spyOn(llm, "chatCompletionActiveModel")
      .mockResolvedValueOnce(JSON.stringify({ recommendations: broken }))
      .mockResolvedValueOnce(JSON.stringify({ recommendations: [] }));

    const out = await runLiveRecommendationsWithTmdbRetry({ historyContext: "ctx" }, config);
    expect(out.recommendations.length).toBeLessThanOrEqual(7);
  });

  it("returns no rows when TMDB cannot verify any suggestion", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValue({ items: [], total: 0, page: 1, pages: 1 });

    const onlyOne = [{ title: "Unknown Film", year: 1999, why: "only suggestion" }];
    vi.spyOn(llm, "chatCompletionActiveModel").mockResolvedValueOnce(JSON.stringify({ recommendations: onlyOne }));

    const out = await runLiveRecommendationsWithTmdbRetry({ historyContext: "ctx" }, config);
    expect(out.recommendations).toHaveLength(0);
  });

  it("stops issuing salvage completions after exhausting the capped retry budget", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValue({ items: [], total: 0, page: 1, pages: 1 });

    const broken = Array.from({ length: 11 }, (_, i) => ({
      title: `BUDGET-${i}`,
      year: 1999,
      why: "x",
    }));

    /** Each wave must propose fresh canonical keys — duplicates are silently skipped via `seenSuggestions`. */
    const wave = (suffix: string) =>
      JSON.stringify({
        recommendations: Array.from({ length: 11 }, (_, i) => ({
          title: `WAVE-${suffix}-${i}`,
          year: 2001,
          why: "nope",
        })),
      });

    vi.spyOn(llm, "chatCompletionActiveModel")
      .mockResolvedValueOnce(JSON.stringify({ recommendations: broken }))
      .mockResolvedValueOnce(wave("A"))
      .mockResolvedValueOnce(wave("B"))
      .mockResolvedValueOnce(wave("C"));

    const out = await runLiveRecommendationsWithTmdbRetry({ historyContext: "ctx" }, config);
    expect(out.disclaimer).toMatch(/Exhausted TMDB-guided AI salvage/);
  });
});

describe("hydrateNlSearchMatches", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enriches matches with TMDB poster art when search resolves", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValueOnce({
      items: [
        {
          tmdbId: 27205,
          title: "Inception",
          releaseYear: 2010,
          posterUrl: "https://image.tmdb.org/t/p/w500/inception.jpg",
          voteAverage: 8.8,
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
    });

    const out = await hydrateNlSearchMatches([
      { title: "Inception", year: 2010, reason: "dream heist vibes" },
    ]);

    expect(out[0]?.tmdbId).toBe(27205);
    expect(out[0]?.posterUrl).toContain("inception.jpg");
    expect(out[0]?.voteAverage).toBe(8.8);
  });

  it("omits NL matches when TMDB cannot resolve", async () => {
    vi.spyOn(tmdb, "tmdbSearchMovies").mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pages: 1,
    });

    const out = await hydrateNlSearchMatches([
      { title: "Local Title", year: 1999, reason: "no tmdb hit" },
    ]);

    expect(out).toHaveLength(0);
  });
});
